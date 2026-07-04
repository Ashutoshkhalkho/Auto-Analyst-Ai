import os
import json
import shutil
import pandas as pd
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.database import (
    init_db, create_dataset, get_datasets, create_pipeline_run, 
    update_pipeline_status, add_agent_log, get_pipeline_runs, get_run_details
)
from app.executor import execute_code
from app.agents import (
    run_data_prep_agent, run_ml_modeling_agent, 
    run_statistical_judge_agent, run_writer_agent, HAS_API_KEY
)

# Initialize database tables
init_db()

app = FastAPI(title="Auto-Analyst AI API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure folders exist
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

class PipelineStartRequest(BaseModel):
    dataset_id: str
    target_col: str
    features: List[str]
    k_clusters: int = 3
    drop_features: Optional[List[str]] = None

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "api_key_configured": HAS_API_KEY,
        "database_type": "Supabase" if os.getenv("SUPABASE_URL") else "SQLite Fallback"
    }

@app.post("/api/upload")
async def upload_dataset(file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
        
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    
    # Save the file
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
        
    try:
        # Load sample to extract metadata
        df = pd.read_csv(file_path)
        row_count = len(df)
        
        # Analyze columns
        columns_json = {}
        for col in df.columns:
            dtype = str(df[col].dtype)
            null_count = int(df[col].isnull().sum())
            missing_pct = float((null_count / row_count) * 100) if row_count > 0 else 0.0
            
            # Classify type
            if df[col].dtype in ['int64', 'float64']:
                classification = "numerical"
            else:
                classification = "categorical"
                
            columns_json[col] = {
                "dtype": dtype,
                "null_count": null_count,
                "missing_pct": missing_pct,
                "type": classification
            }
            
        # Store in database
        dataset_id = create_dataset(file.filename, row_count, columns_json)
        
        return {
            "dataset_id": dataset_id,
            "file_name": file.filename,
            "row_count": row_count,
            "columns": columns_json
        }
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Failed to process CSV file: {str(e)}")

@app.get("/api/datasets")
def list_datasets():
    return get_datasets()

@app.get("/api/runs")
def list_runs():
    return get_pipeline_runs()

@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    details = get_run_details(run_id)
    if not details:
        raise HTTPException(status_code=404, detail="Pipeline run not found.")
    return details

@app.post("/api/start-pipeline")
def start_pipeline(req: PipelineStartRequest):
    # Retrieve dataset info to make sure it exists
    datasets = get_datasets()
    dataset = next((d for d in datasets if d["id"] == req.dataset_id), None)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found.")
        
    # Create the run record
    run_id = create_pipeline_run(req.dataset_id)
    return {
        "run_id": run_id,
        "status": "pending",
        "message": "Pipeline run initialized. Connect to WebSocket to execute."
    }

# Active WebSocket manager for streaming updates
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}

    async def connect(self, websocket: WebSocket, run_id: str):
        await websocket.accept()
        self.active_connections[run_id] = websocket

    def disconnect(self, run_id: str):
        if run_id in self.active_connections:
            del self.active_connections[run_id]

    async def send_json(self, run_id: str, message: dict):
        if run_id in self.active_connections:
            await self.active_connections[run_id].send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/pipeline/{run_id}")
async def websocket_pipeline(websocket: WebSocket, run_id: str):
    await manager.connect(websocket, run_id)
    
    try:
        # 1. Fetch Pipeline Run and Dataset info
        run_details = get_run_details(run_id)
        if not run_details:
            await websocket.send_json({"type": "error", "message": "Pipeline run not found."})
            return
            
        dataset = run_details["dataset"]
        dataset_path = os.path.join(UPLOAD_DIR, dataset["file_name"])
        
        # Verify file exists
        if not os.path.exists(dataset_path):
            await websocket.send_json({"type": "error", "message": f"Dataset file '{dataset['file_name']}' not found on server."})
            return
            
        # Parse start parameters from client or DB defaults
        start_data = await websocket.receive_json()
        target_col = start_data.get("target_col")
        features = start_data.get("features", [])
        k_clusters = start_data.get("k_clusters", 3)
        drop_features = start_data.get("drop_features", [])
        
        # Start executing
        await run_pipeline_orchestrator(run_id, dataset, dataset_path, target_col, features, k_clusters, drop_features)
        
    except WebSocketDisconnect:
        manager.disconnect(run_id)
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": f"Pipeline failure: {str(e)}"})
        except:
            pass
        manager.disconnect(run_id)

# In-memory session store service to track run temperatures and progressive refinement state
class InMemorySessionService:
    def __init__(self):
        self.sessions = {}

    def get_session(self, run_id: str) -> dict:
        if run_id not in self.sessions:
            self.sessions[run_id] = {
                "temperature": 0.1,
                "dropped_features": [],
                "iterations": [],
                "refinement_prompt": None
            }
        return self.sessions[run_id]

    def update_session(self, run_id: str, **kwargs):
        session = self.get_session(run_id)
        for k, v in kwargs.items():
            session[k] = v

in_memory_session_service = InMemorySessionService()

async def run_pipeline_orchestrator(
    run_id: str, dataset: dict, dataset_path: str, target_col: str, 
    features: list, k_clusters: int, drop_features: list
):
    # Setup initial state variables in in-memory session service
    session_state = in_memory_session_service.get_session(run_id)
    session_state["dropped_features"] = list(drop_features)
    
    self_correction_count = 0
    max_self_correction = 3
    final_metrics = {}
    judge_approved = False
    judge_critique = "No evaluation performed."
    
    cleaned_persistent_path = os.path.join(UPLOAD_DIR, f"cleaned_{run_id}.csv")
    
    # ------------------ STEP 1: DATA PREPARATION ------------------
    update_pipeline_status(run_id, "cleaning")
    await manager.send_json(run_id, {
        "type": "state_update",
        "step": "data_prep",
        "status": "active",
        "message": "Data Prep Agent: Generating data cleaning and normalization script..."
    })
    
    # Generate cleaning code
    data_prep_res = run_data_prep_agent(
        dataset["file_name"], dataset["row_count"], dataset["columns_json"], session_state["dropped_features"]
    )
    
    # Log agent interaction
    add_agent_log(run_id, "data_prep", f"Clean columns using drops: {session_state['dropped_features']}", data_prep_res.explanation, data_prep_res.code)
    
    await manager.send_json(run_id, {
        "type": "agent_message",
        "agent": "data_prep",
        "explanation": data_prep_res.explanation,
        "code": data_prep_res.code
    })
    
    # Run generated code
    await manager.send_json(run_id, {"type": "state_update", "step": "data_prep", "status": "running", "message": "Executing data prep script..."})
    exec_res = execute_code(
        data_prep_res.code, 
        dataset_path,
        output_files={"cleaned_dataset.csv": cleaned_persistent_path}
    )
    
    # Stream terminal logs
    await manager.send_json(run_id, {
        "type": "terminal_logs",
        "stdout": exec_res["stdout"],
        "stderr": exec_res["stderr"]
    })
    
    if not exec_res["success"]:
        update_pipeline_status(run_id, "failed")
        await manager.send_json(run_id, {"type": "state_update", "step": "data_prep", "status": "failed", "message": "Data Prep execution failed. Stopping pipeline."})
        return
        
    await manager.send_json(run_id, {"type": "state_update", "step": "data_prep", "status": "success", "message": "Data Prep completed successfully."})
    
    # ------------------ STEP 2: ML MODELING & DUAL-STAGE SELF-CORRECTION LOOP ------------------
    update_pipeline_status(run_id, "modeling")
    
    last_modeling_code = ""
    last_modeling_explanation = ""
    
    while self_correction_count < max_self_correction:
        # Decrement temperature slightly for progressive runs
        current_temp = max(0.0, 0.1 - 0.04 * self_correction_count)
        session_state["temperature"] = current_temp
        
        await manager.send_json(run_id, {
            "type": "state_update",
            "step": "ml_modeler",
            "status": "active",
            "message": f"ML Modeler Agent: Writing modeling script (Attempt {self_correction_count + 1}, Temp: {current_temp:.2f})..."
        })
        
        # Run modeler with active session parameters
        modeling_res = run_ml_modeling_agent(
            features, 
            target_col, 
            k_clusters, 
            session_state["dropped_features"], 
            temperature=current_temp,
            refinement_prompt=session_state["refinement_prompt"]
        )
        
        last_modeling_code = modeling_res.code
        last_modeling_explanation = modeling_res.explanation
        
        add_agent_log(
            run_id, "ml_modeler", 
            f"Model config: features={features}, target={target_col}, k={k_clusters}, drops={session_state['dropped_features']}, temp={current_temp}, refinement={session_state['refinement_prompt']}", 
            modeling_res.explanation, modeling_res.code
        )
        
        await manager.send_json(run_id, {
            "type": "agent_message",
            "agent": "ml_modeler",
            "explanation": modeling_res.explanation,
            "code": modeling_res.code
        })
        
        # Execute modeling script
        await manager.send_json(run_id, {"type": "state_update", "step": "ml_modeler", "status": "running", "message": "Running ML modeling code..."})
        exec_res = execute_code(
            modeling_res.code, 
            dataset_path, 
            additional_inputs={"cleaned_dataset.csv": cleaned_persistent_path}
        )
        
        # Send terminal outputs
        await manager.send_json(run_id, {
            "type": "terminal_logs",
            "stdout": exec_res["stdout"],
            "stderr": exec_res["stderr"]
        })
        
        # Send plots if any
        if exec_res.get("plots"):
            await manager.send_json(run_id, {
                "type": "plots",
                "plots": exec_res["plots"]
            })
            
        metrics = exec_res.get("metrics", {})
        
        # Log trajectory evaluation in Supabase agent_logs
        trajectory_raw_prompt = json.dumps(dataset["columns_json"])
        trajectory_model_response = json.dumps({
            "stdout": exec_res["stdout"],
            "stderr": exec_res["stderr"],
            "metrics": metrics,
            "success": exec_res["success"],
            "iteration": self_correction_count
        })
        add_agent_log(
            run_id,
            "trajectory_evaluation",
            trajectory_raw_prompt,
            trajectory_model_response,
            modeling_res.code
        )
        
        # Store iteration results in state session service
        session_state["iterations"].append({
            "iteration_index": self_correction_count,
            "metrics": metrics,
            "code": modeling_res.code,
            "explanation": modeling_res.explanation,
            "stdout": exec_res["stdout"],
            "stderr": exec_res["stderr"],
            "plots": exec_res.get("plots", []),
            "success": exec_res["success"]
        })
        
        # STAGE 1: Code Safety & Syntax checks
        if not exec_res["success"]:
            tb = exec_res["stderr"] or exec_res["stdout"] or "Unknown execution error."
            await manager.send_json(run_id, {
                "type": "state_update", 
                "step": "ml_modeler", 
                "status": "failed", 
                "message": "Stage 1: Syntax failure detected! Preparing progressive refinement feedback..."
            })
            
            # Formulate progressive refinement traceback prompt
            session_state["refinement_prompt"] = f"""
The previous Python modeling script failed to execute.
Traceback error:
{tb}

Please fix the script to compile safely. Double check imports and variables.
"""
            self_correction_count += 1
            continue
            
        # STAGE 2: Statistical Boundary Analysis
        update_pipeline_status(run_id, "validating")
        await manager.send_json(run_id, {
            "type": "state_update",
            "step": "statistical_judge",
            "status": "active",
            "message": "Stage 2: Statistical Judge Agent evaluating regression coefficients and VIF boundaries..."
        })
        
        # Invoke LLM-as-a-judge
        judge_res = run_statistical_judge_agent(metrics, exec_res["stdout"] + exec_res["stderr"], self_correction_count)
        judge_critique = judge_res.critique
        judge_approved = judge_res.approved
        
        add_agent_log(
            run_id, "statistical_judge", 
            f"Metrics: {json.dumps(metrics)}", 
            judge_res.critique, 
            json.dumps(judge_res.suggested_overrides)
        )
        
        await manager.send_json(run_id, {
            "type": "agent_message",
            "agent": "statistical_judge",
            "explanation": judge_res.critique,
            "code": ""
        })
        
        # Check approval
        r2 = metrics.get("r2", 0.0)
        vifs = metrics.get("vifs", {})
        high_vifs = [k for k, v in vifs.items() if v > 5.0]
        
        # Overrides suggested by LLM
        overrides = judge_res.suggested_overrides or {}
        new_drops = overrides.get("drop_features", [])
        
        # Ensure VIF high items are added to drops
        for hv in high_vifs:
            if hv not in new_drops:
                new_drops.append(hv)
                
        if judge_approved and r2 >= 0.60 and len(high_vifs) == 0:
            await manager.send_json(run_id, {
                "type": "state_update",
                "step": "statistical_judge",
                "status": "success",
                "message": f"Stage 2: Model approved! R2={r2:.4f} >= 0.60, Max VIF={max(vifs.values()) if vifs else 1.0:.2f} <= 5.0."
            })
            final_metrics = metrics
            break
        else:
            self_correction_count += 1
            final_metrics = metrics
            
            # Setup correction settings in session store
            if new_drops:
                session_state["dropped_features"].extend([d for d in new_drops if d not in session_state["dropped_features"]])
            
            if self_correction_count < max_self_correction:
                # Progressive refinement feedback for statistical issues
                session_state["refinement_prompt"] = f"""
The previous modeling script fit was statistically rejected.
Critique: {judge_critique}
Action required: Exclude or drop multicollinear features: {new_drops}
"""
                await manager.send_json(run_id, {
                    "type": "state_update",
                    "step": "self_correction",
                    "status": "active",
                    "message": f"Judge rejected model (R2={r2:.3f}, Multicollinear features={new_drops}). Retrying pass {self_correction_count + 1}..."
                })
            else:
                await manager.send_json(run_id, {
                    "type": "state_update",
                    "step": "statistical_judge",
                    "status": "failed",
                    "message": "Stage 2: Statistical boundaries failed. Max loop limit reached."
                })
                
    # ------------------ SELECTION OF OPTIMAL MODEL (IF MAXIMUM ATTEMPTS REACHED) ------------------
    if not judge_approved:
        # Gracefully select optimal run from iterations history
        valid_iterations = [it for it in session_state["iterations"] if it["success"]]
        if valid_iterations:
            # Optimal model is the one with highest R2 score
            best_iter = max(valid_iterations, key=lambda x: x["metrics"].get("r2", 0.0))
            best_idx = best_iter["iteration_index"]
            best_r2 = best_iter["metrics"].get("r2", 0.0)
            
            final_metrics = best_iter["metrics"]
            last_modeling_code = best_iter["code"]
            last_modeling_explanation = best_iter["explanation"]
            
            system_badge = f"[SYSTEM PERFORMANCE: COMPLETED WITH STATISTICAL WARNINGS - OPTIMAL ITERATION {best_idx + 1} SELECTED (R2={best_r2:.4f})]"
            
            judge_critique = f"{system_badge}\n\nMaximum self-correction threshold of 3 runs reached. Statistical boundaries (R2 >= 0.60, VIF <= 5.0) were not fully satisfied in all iterations. Optimal iteration {best_idx + 1} was restored as the final model fit."
            
            await manager.send_json(run_id, {
                "type": "state_update",
                "step": "self_correction",
                "status": "success",
                "message": f"Restored optimal iteration {best_idx + 1} (R2={best_r2:.3f})."
            })
        else:
            system_badge = "[SYSTEM PERFORMANCE: PIPELINE FAILED - NO VALID ITERATION EXECUTED]"
            judge_critique = f"{system_badge}\n\nAll 3 execution attempts encountered syntax or runtime errors. No model could be successfully fitted."
            
    # ------------------ STEP 4: WRITER AGENT (INSIGHT TRANSLATOR) ------------------
    update_pipeline_status(run_id, "modeling" if self_correction_count >= max_self_correction and not judge_approved and not session_state["iterations"] else "validating")
    await manager.send_json(run_id, {
        "type": "state_update",
        "step": "writer",
        "status": "active",
        "message": "Writer Agent: Translating numerical results into business insights markdown..."
    })
    
    # Generate final report using selected metrics
    writer_res = run_writer_agent(
        dataset["file_name"], dataset["row_count"], dataset["columns_json"],
        data_prep_res.explanation, last_modeling_explanation, final_metrics, judge_critique
    )
    
    add_agent_log(
        run_id, "writer",
        f"Generate insights report for: {dataset['file_name']}",
        writer_res.markdown_report,
        ""
    )
    
    await manager.send_json(run_id, {
        "type": "agent_message",
        "agent": "writer",
        "explanation": writer_res.markdown_report,
        "code": ""
    })
    
    # Finish pipeline run
    final_status = "completed" if judge_approved or any(it["success"] for it in session_state["iterations"]) else "failed"
    update_pipeline_status(run_id, final_status, final_metrics)
    
    await manager.send_json(run_id, {
        "type": "state_update",
        "step": "completed",
        "status": "success" if final_status == "completed" else "failed",
        "message": f"Pipeline execution completed with status: {final_status.upper()}"
    })
