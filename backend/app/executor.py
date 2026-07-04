import os
import sys
import subprocess
import tempfile
import shutil
import base64
import glob
import ast

def verify_code_safety(code_string: str) -> (bool, str):
    """
    Scans the generated Python code block before execution.
    - Prevents system command calls (os.system, subprocess, etc.)
    - Prevents network operations (requests, urllib, socket)
    - Enforces import whitelist (pandas, numpy, scikit-learn, statsmodels, matplotlib, seaborn, json, math)
    - Restricts local file operations to authorized inputs/outputs.
    """
    # 1. Broad string analysis for blocked calls
    blocked_keywords = [
        "os.system", "subprocess", "shutil", "sys.argv", "sys.exit", 
        "eval(", "exec(", "globals()", "locals()", "requests", "urllib", 
        "socket", "ftplib", "http.client", "urllib2", "webbrowser",
        "tempfile", "pathlib", "os.walk", "os.listdir", "os.remove", 
        "os.rmdir", "os.rename", "os.replace", "os.chmod", "os.chown"
    ]
    for kw in blocked_keywords:
        if kw in code_string:
            return False, f"Blocked code containing unsafe keyword: '{kw}'"

    # 2. AST parsing to inspect import targets and open() file paths
    try:
        root = ast.parse(code_string)
    except SyntaxError as se:
        return False, f"Syntax Error during safety verification: {str(se)}"

    allowed_modules = {
        "pandas", "numpy", "sklearn", "sklearn.linear_model", "sklearn.cluster", 
        "sklearn.metrics", "sklearn.preprocessing", "statsmodels", 
        "statsmodels.stats.outliers_influence", "matplotlib", "matplotlib.pyplot", 
        "seaborn", "json", "math", "warnings", "datetime", "collections"
    }

    for node in ast.walk(root):
        # Enforce whitelist on imports
        if isinstance(node, ast.Import):
            for name in node.names:
                base_module = name.name.split('.')[0]
                if base_module not in allowed_modules:
                    return False, f"Package Hallucination / Blocked Import: module '{name.name}' is not whitelisted."
        elif isinstance(node, ast.ImportFrom):
            base_module = node.module.split('.')[0] if node.module else ""
            if base_module not in allowed_modules:
                return False, f"Package Hallucination / Blocked Import: module '{node.module}' is not whitelisted."

        # Restrict open() file calls to allowed filenames only
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "open":
                if len(node.args) > 0:
                    arg = node.args[0]
                    if isinstance(arg, ast.Constant):
                        filename = str(arg.value)
                    elif isinstance(arg, ast.Str):
                        filename = arg.s
                    else:
                        return False, "Dynamic filename calls in 'open()' are forbidden for safety."

                    allowed_files = {"dataset.csv", "cleaned_dataset.csv", "metrics.json", "clean.csv"}
                    base_name = os.path.basename(filename)
                    if base_name not in allowed_files:
                        return False, f"Security Block: Attempt to access local file '{filename}' outside of allowed workspace files ('dataset.csv', 'cleaned_dataset.csv', 'metrics.json', 'clean.csv')."

            # Block dangerous attributes calls on imported packages
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr in ("system", "popen", "subprocess", "rmtree", "remove", "listdir"):
                    return False, f"Security Block: Dangerous method call '{node.func.attr}' is blocked."

    return True, ""

def execute_code(
    code_string: str, 
    dataset_path: str, 
    additional_inputs: dict = None, 
    output_files: dict = None
) -> dict:
    """
    Executes Python code blocks in a sandbox directory with the dataset loaded.
    Injects a matplotlib.pyplot.show interceptor to capture any plotted graphs.
    Supports additional inputs and output file persistence.
    """
    # Run safety checks
    is_safe, violation_reason = verify_code_safety(code_string)
    if not is_safe:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Safety Guardrail Exception: {violation_reason}",
            "exit_code": -1,
            "plots": [],
            "metrics": {}
        }

    # Create temporary execution directory
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Copy primary dataset to temporary directory as 'dataset.csv'
        dest_dataset_path = os.path.join(temp_dir, "dataset.csv")
        shutil.copy2(dataset_path, dest_dataset_path)
        
        # Copy additional input files if provided
        if additional_inputs:
            for sandbox_name, src_path in additional_inputs.items():
                if os.path.exists(src_path):
                    shutil.copy2(src_path, os.path.join(temp_dir, sandbox_name))
        
        # Intercept plt.show() to save plots as png files
        interceptor = """
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
_original_show = plt.show
_plot_counter = 0

def _intercepted_show(*args, **kwargs):
    global _plot_counter
    plt.savefig(f"plot_{_plot_counter}.png", bbox_inches='tight', dpi=150)
    plt.close()
    _plot_counter += 1

plt.show = _intercepted_show
"""
        
        # Complete script combines the interceptor and user code
        full_code = interceptor + "\n" + code_string
        
        script_path = os.path.join(temp_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(full_code)
            
        # Get path to Python executable in current virtualenv
        python_exe = sys.executable
        if not python_exe:
            python_exe = "python"
            
        # Run script
        process = subprocess.run(
            [python_exe, "script.py"],
            cwd=temp_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30 # 30 seconds limit
        )
        
        stdout = process.stdout
        stderr = process.stderr
        exit_code = process.returncode
        
        # Find any generated plots
        plots = []
        plot_files = sorted(glob.glob(os.path.join(temp_dir, "plot_*.png")))
        for pf in plot_files:
            try:
                with open(pf, "rb") as image_file:
                    encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                    plots.append(encoded_string)
            except Exception as e:
                stderr += f"\nError reading generated plot: {str(e)}"
                
        # Read metrics.json if generated
        import json
        metrics = {}
        metrics_path = os.path.join(temp_dir, "metrics.json")
        if os.path.exists(metrics_path):
            try:
                with open(metrics_path, "r") as f:
                    metrics = json.load(f)
            except Exception as e:
                stderr += f"\nError reading metrics.json: {str(e)}"
                
        # Persist requested output files
        if output_files:
            for sandbox_name, dest_path in output_files.items():
                sandbox_file_path = os.path.join(temp_dir, sandbox_name)
                if os.path.exists(sandbox_file_path):
                    dir_name = os.path.dirname(dest_path)
                    if dir_name:
                        os.makedirs(dir_name, exist_ok=True)
                    shutil.copy2(sandbox_file_path, dest_path)
                    
        return {
            "success": exit_code == 0,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code,
            "plots": plots,
            "metrics": metrics
        }
        
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "stdout": "",
            "stderr": "Execution Timeout: Code took longer than 30 seconds to run.",
            "exit_code": -1,
            "plots": []
        }
    except Exception as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Execution Error: {str(e)}",
            "exit_code": -99,
            "plots": []
        }
    finally:
        # Clean up temporary directory
        shutil.rmtree(temp_dir, ignore_errors=True)

