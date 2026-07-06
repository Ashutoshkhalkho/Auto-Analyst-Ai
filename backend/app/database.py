import os
import json
import uuid
from datetime import datetime
from dotenv import load_dotenv

# Load env variables from root or backend env files
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Check if we should use Supabase or SQLite
USE_SUPABASE = False
if SUPABASE_URL and SUPABASE_KEY:
    import httpx
    try:
        # Perform a quick reachability check to Supabase with a 3.0s timeout
        with httpx.Client(timeout=3.0) as client:
            response = client.get(SUPABASE_URL)
            if response.status_code in (200, 401, 403, 404): # Any response from server means it is reachable
                USE_SUPABASE = True
            else:
                print(f"Supabase returned status {response.status_code}. Falling back to SQLite.")
    except Exception as e:
        print(f"Supabase connection check failed: {e}. Falling back to SQLite.")

# If SQLite fallback is active, import SQLAlchemy dependencies
if not USE_SUPABASE:
    from sqlalchemy import create_engine, Column, String, Integer, DateTime, ForeignKey, Text
    from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
    from sqlalchemy.ext.declarative import declarative_base
    from sqlalchemy.orm import sessionmaker

    SQLITE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "auto_analyst.db")
    engine = create_engine(f"sqlite:///{SQLITE_PATH}", connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base = declarative_base()

    class SQLiteDataset(Base):
        __tablename__ = "datasets"
        id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
        created_at = Column(DateTime, default=datetime.utcnow)
        file_name = Column(String, nullable=False)
        row_count = Column(Integer, nullable=False)
        columns_json = Column(Text, nullable=False) # store as text string in sqlite

    class SQLitePipelineRun(Base):
        __tablename__ = "pipeline_runs"
        id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
        dataset_id = Column(String, ForeignKey("datasets.id"), nullable=False)
        created_at = Column(DateTime, default=datetime.utcnow)
        run_status = Column(String, nullable=False, default="pending") # pending, cleaning, modeling, validating, completed, failed
        final_metrics = Column(Text, nullable=True) # store as text string in sqlite

    class SQLiteAgentLog(Base):
        __tablename__ = "agent_logs"
        id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
        run_id = Column(String, ForeignKey("pipeline_runs.id"), nullable=False)
        created_at = Column(DateTime, default=datetime.utcnow)
        agent_name = Column(String, nullable=False) # data_prep, ml_modeler, statistical_judge, writer
        raw_prompt = Column(Text, nullable=False)
        model_response = Column(Text, nullable=False)
        execution_code_used = Column(Text, nullable=True)

    Base.metadata.create_all(bind=engine)
else:
    from supabase import create_client, Client
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def init_db():
    # SQLite tables are created automatically on import.
    # For Supabase, the user should execute the SQL schema.
    if USE_SUPABASE:
        print("Using Supabase Database connection.")
    else:
        print(f"Using local SQLite database fallback at {SQLITE_PATH}")

# CRUD Interfaces

def create_dataset(file_name: str, row_count: int, columns_json: dict) -> str:
    dataset_id = str(uuid.uuid4())
    now_str = datetime.utcnow().isoformat()
    
    if USE_SUPABASE:
        data = {
            "id": dataset_id,
            "file_name": file_name,
            "row_count": row_count,
            "columns_json": columns_json
        }
        supabase.table("datasets").insert(data).execute()
    else:
        db = SessionLocal()
        try:
            db_dataset = SQLiteDataset(
                id=dataset_id,
                file_name=file_name,
                row_count=row_count,
                columns_json=json.dumps(columns_json)
            )
            db.add(db_dataset)
            db.commit()
        finally:
            db.close()
            
    return dataset_id

def get_datasets() -> list:
    if USE_SUPABASE:
        response = supabase.table("datasets").select("*").order("created_at", desc=True).execute()
        return response.data
    else:
        db = SessionLocal()
        try:
            datasets = db.query(SQLiteDataset).order_by(SQLiteDataset.created_at.desc()).all()
            result = []
            for d in datasets:
                result.append({
                    "id": d.id,
                    "created_at": d.created_at.isoformat(),
                    "file_name": d.file_name,
                    "row_count": d.row_count,
                    "columns_json": json.loads(d.columns_json)
                })
            return result
        finally:
            db.close()

def create_pipeline_run(dataset_id: str) -> str:
    run_id = str(uuid.uuid4())
    if USE_SUPABASE:
        data = {
            "id": run_id,
            "dataset_id": dataset_id,
            "run_status": "pending",
            "final_metrics": {}
        }
        supabase.table("pipeline_runs").insert(data).execute()
    else:
        db = SessionLocal()
        try:
            db_run = SQLitePipelineRun(
                id=run_id,
                dataset_id=dataset_id,
                run_status="pending",
                final_metrics=json.dumps({})
            )
            db.add(db_run)
            db.commit()
        finally:
            db.close()
    return run_id

def update_pipeline_status(run_id: str, status: str, final_metrics: dict = None) -> None:
    if USE_SUPABASE:
        data = {"run_status": status}
        if final_metrics is not None:
            data["final_metrics"] = final_metrics
        supabase.table("pipeline_runs").update(data).eq("id", run_id).execute()
    else:
        db = SessionLocal()
        try:
            db_run = db.query(SQLitePipelineRun).filter(SQLitePipelineRun.id == run_id).first()
            if db_run:
                db_run.run_status = status
                if final_metrics is not None:
                    db_run.final_metrics = json.dumps(final_metrics)
                db.commit()
        finally:
            db.close()

def add_agent_log(run_id: str, agent_name: str, raw_prompt: str, model_response: str, execution_code_used: str = None) -> str:
    log_id = str(uuid.uuid4())
    if USE_SUPABASE:
        data = {
            "id": log_id,
            "run_id": run_id,
            "agent_name": agent_name,
            "raw_prompt": raw_prompt,
            "model_response": model_response,
            "execution_code_used": execution_code_used or ""
        }
        supabase.table("agent_logs").insert(data).execute()
    else:
        db = SessionLocal()
        try:
            db_log = SQLiteAgentLog(
                id=log_id,
                run_id=run_id,
                agent_name=agent_name,
                raw_prompt=raw_prompt,
                model_response=model_response,
                execution_code_used=execution_code_used
            )
            db.add(db_log)
            db.commit()
        finally:
            db.close()
    return log_id

def get_pipeline_runs() -> list:
    if USE_SUPABASE:
        # Join with datasets
        response = supabase.table("pipeline_runs").select("*, datasets(file_name)").order("created_at", desc=True).execute()
        runs = []
        for r in response.data:
            runs.append({
                "id": r["id"],
                "dataset_id": r["dataset_id"],
                "created_at": r["created_at"],
                "run_status": r["run_status"],
                "final_metrics": r["final_metrics"],
                "file_name": r["datasets"]["file_name"] if r.get("datasets") else "Unknown"
            })
        return runs
    else:
        db = SessionLocal()
        try:
            # Join SQLite
            runs = db.query(SQLitePipelineRun).order_by(SQLitePipelineRun.created_at.desc()).all()
            result = []
            for r in runs:
                dataset = db.query(SQLiteDataset).filter(SQLiteDataset.id == r.dataset_id).first()
                file_name = dataset.file_name if dataset else "Unknown"
                result.append({
                    "id": r.id,
                    "dataset_id": r.dataset_id,
                    "created_at": r.created_at.isoformat(),
                    "run_status": r.run_status,
                    "final_metrics": json.loads(r.final_metrics) if r.final_metrics else {},
                    "file_name": file_name
                })
            return result
        finally:
            db.close()

def get_run_details(run_id: str) -> dict:
    if USE_SUPABASE:
        run_resp = supabase.table("pipeline_runs").select("*, datasets(*)").eq("id", run_id).single().execute()
        logs_resp = supabase.table("agent_logs").select("*").eq("run_id", run_id).order("created_at", desc=False).execute()
        r = run_resp.data
        return {
            "id": r["id"],
            "dataset_id": r["dataset_id"],
            "created_at": r["created_at"],
            "run_status": r["run_status"],
            "final_metrics": r["final_metrics"],
            "dataset": r["datasets"],
            "logs": logs_resp.data
        }
    else:
        db = SessionLocal()
        try:
            r = db.query(SQLitePipelineRun).filter(SQLitePipelineRun.id == run_id).first()
            if not r:
                return {}
            dataset = db.query(SQLiteDataset).filter(SQLiteDataset.id == r.dataset_id).first()
            logs = db.query(SQLiteAgentLog).filter(SQLiteAgentLog.run_id == run_id).order_by(SQLiteAgentLog.created_at.asc()).all()
            
            dataset_data = {}
            if dataset:
                dataset_data = {
                    "id": dataset.id,
                    "created_at": dataset.created_at.isoformat(),
                    "file_name": dataset.file_name,
                    "row_count": dataset.row_count,
                    "columns_json": json.loads(dataset.columns_json)
                }
                
            log_data = []
            for l in logs:
                log_data.append({
                    "id": l.id,
                    "run_id": l.run_id,
                    "created_at": l.created_at.isoformat(),
                    "agent_name": l.agent_name,
                    "raw_prompt": l.raw_prompt,
                    "model_response": l.model_response,
                    "execution_code_used": l.execution_code_used
                })
                
            return {
                "id": r.id,
                "dataset_id": r.dataset_id,
                "created_at": r.created_at.isoformat(),
                "run_status": r.run_status,
                "final_metrics": json.loads(r.final_metrics) if r.final_metrics else {},
                "dataset": dataset_data,
                "logs": log_data
            }
        finally:
            db.close()
