import os
import sys
import pandas as pd
import json

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))

from app.database import (
    init_db, create_dataset, get_datasets, create_pipeline_run,
    update_pipeline_status, add_agent_log, get_pipeline_runs, get_run_details
)
from app.executor import execute_code
from app.agents import (
    run_data_prep_agent, run_ml_modeling_agent,
    run_statistical_judge_agent, run_writer_agent
)

def run_test():
    print("=== STARTING BACKEND PIPELINE VALIDATION ===")
    
    # 1. Initialize DB
    init_db()
    
    # 2. Create a dummy dataset
    dummy_csv_path = "dummy_sales.csv"
    data = {
        "advertising_budget": [10.2, 12.5, 15.0, 8.2, 20.1, 14.3, 11.1, 18.2, 9.5, 13.0],
        "website_visits": [120, 140, 180, 95, 220, 160, 130, 210, 105, 145],
        "promo_code": ["Yes", "No", "Yes", "No", "Yes", "Yes", "No", "Yes", "No", "No"],
        "sales_outcome": [22.4, 25.1, 31.2, 18.0, 42.1, 30.5, 23.2, 38.0, 19.8, 26.3]
    }
    df = pd.DataFrame(data)
    df.to_csv(dummy_csv_path, index=False)
    print(f"Created dummy dataset at {dummy_csv_path} with shape {df.shape}")
    
    # 3. Analyze and register dataset
    row_count = len(df)
    columns_json = {}
    for col in df.columns:
        dtype = str(df[col].dtype)
        null_count = int(df[col].isnull().sum())
        missing_pct = float((null_count / row_count) * 100)
        classification = "numerical" if df[col].dtype in ['int64', 'float64'] else "categorical"
        columns_json[col] = {
            "dtype": dtype,
            "null_count": null_count,
            "missing_pct": missing_pct,
            "type": classification
        }
        
    print("Analyzed schema metadata:")
    print(json.dumps(columns_json, indent=2))
    
    dataset_id = create_dataset("dummy_sales.csv", row_count, columns_json)
    print(f"Dataset successfully registered in DB. ID: {dataset_id}")
    
    # 4. Start pipeline run
    run_id = create_pipeline_run(dataset_id)
    print(f"Pipeline run initialized in DB. Run ID: {run_id}")
    
    # 5. Execute Data Prep
    print("\n--- STEP 1: Data Preparation Agent ---")
    data_prep_res = run_data_prep_agent("dummy_sales.csv", row_count, columns_json, drop_features=[])
    print(f"Prep Explanation:\n{data_prep_res.explanation}")
    
    add_agent_log(run_id, "data_prep", "Clean columns", data_prep_res.explanation, data_prep_res.code)
    
    # Run data prep in executor
    cleaned_path = "cleaned_dummy.csv"
    exec_res = execute_code(
        data_prep_res.code, 
        dummy_csv_path, 
        output_files={"cleaned_dataset.csv": cleaned_path}
    )
    
    print(f"Executor Success: {exec_res['success']}")
    print(f"Executor stdout:\n{exec_res['stdout']}")
    if exec_res['stderr']:
        print(f"Executor stderr:\n{exec_res['stderr']}")
        
    # Check if file was saved
    if os.path.exists(cleaned_path):
        print(f"Cleaned file verified at {cleaned_path}")
        cleaned_df = pd.read_csv(cleaned_path)
        print(f"Cleaned df shape: {cleaned_df.shape}")
    else:
        print("ERROR: Cleaned file not found!")
        return
        
    # 6. Execute ML Modeling
    print("\n--- STEP 2: ML Modeler Agent ---")
    features = ["advertising_budget", "website_visits"]
    target_col = "sales_outcome"
    modeling_res = run_ml_modeling_agent(features, target_col, k_clusters=3, drop_features=[])
    print(f"Modeling Explanation:\n{modeling_res.explanation}")
    
    add_agent_log(run_id, "ml_modeler", "Train models", modeling_res.explanation, modeling_res.code)
    
    exec_res2 = execute_code(
        modeling_res.code,
        dummy_csv_path,
        additional_inputs={"cleaned_dataset.csv": cleaned_path}
    )
    
    print(f"Executor Modeling Success: {exec_res2['success']}")
    print(f"Executor stdout:\n{exec_res2['stdout']}")
    if exec_res2['stderr']:
        print(f"Executor stderr:\n{exec_res2['stderr']}")
        
    metrics = exec_res2.get("metrics", {})
    plots = exec_res2.get("plots", [])
    print(f"Extracted Metrics from sandbox: {metrics}")
    print(f"Number of generated plots: {len(plots)}")
    
    # 7. Execute Statistical Judge
    print("\n--- STEP 3: Statistical Judge Agent ---")
    judge_res = run_statistical_judge_agent(metrics, exec_res2["stdout"] + exec_res2["stderr"], self_correction_count=0)
    print(f"Judge Approved: {judge_res.approved}")
    print(f"Judge Critique:\n{judge_res.critique}")
    
    add_agent_log(run_id, "statistical_judge", "Judge fit", judge_res.critique, json.dumps(judge_res.suggested_overrides))
    
    # 8. Execute Writer Agent
    print("\n--- STEP 4: Writer Agent ---")
    writer_res = run_writer_agent(
        "dummy_sales.csv", row_count, columns_json,
        data_prep_res.explanation, modeling_res.explanation, metrics, judge_res.critique
    )
    print(f"Writer report generated:\n{writer_res.markdown_report[:200]}...")
    
    add_agent_log(run_id, "writer", "Compile insights", writer_res.markdown_report, "")
    
    # Complete run
    update_pipeline_status(run_id, "completed" if judge_res.approved else "failed", metrics)
    print("\n--- Pipeline completed successfully in DB ---")
    
    # 9. Verify details from database
    details = get_run_details(run_id)
    print(f"Verified run status from DB: {details['run_status']}")
    print(f"Total log records in DB: {len(details['logs'])}")
    
    # Clean up test files
    for path in [dummy_csv_path, cleaned_path]:
        if os.path.exists(path):
            os.remove(path)
            
    print("\n=== VALIDATION COMPLETED SUCCESSFULLY ===")

if __name__ == "__main__":
    run_test()
