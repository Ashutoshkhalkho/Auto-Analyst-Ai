import os
import sys
import unittest
import json
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

# Add backend directory to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(backend_dir, "app"))

from app.main import app
from app.database import init_db, get_run_details, create_pipeline_run, update_pipeline_status
from app.executor import execute_code
from app.agents import (
    run_data_prep_agent, run_statistical_judge_agent, HAS_API_KEY
)
from google.genai import types

class TestAutoAnalystSuite(unittest.TestCase):
    
    def setUp(self):
        print("\n--- SETTING UP SYNTHETIC DATASET ---")
        # Ensure clean database initialization (local SQLite fallback)
        init_db()
        
        # 1. Generate Synthetic Dataset
        np.random.seed(42)
        n_rows = 100
        
        # Feature A: Uniform distribution
        feature_a = np.random.uniform(10.0, 100.0, n_rows)
        
        # Feature B: Strong linear dependency on Feature A (introducing multicollinearity)
        # feature_b = 2.0 * feature_a + small noise
        feature_b = 2.0 * feature_a + np.random.normal(0.0, 0.05, n_rows)
        
        # Feature C: Normal distribution
        feature_c = np.random.normal(50.0, 15.0, n_rows)
        
        # Target: Linear combination of features
        target = 3.5 * feature_a + 0.8 * feature_c + np.random.normal(0.0, 1.0, n_rows)
        
        # 2. Inject missing parameters (np.nan) in 10% of the rows (10 rows)
        # We will inject nulls randomly across the features
        null_indices_a = np.random.choice(n_rows, 5, replace=False)
        null_indices_c = np.random.choice(n_rows, 5, replace=False)
        
        feature_a_with_nulls = feature_a.copy()
        feature_c_with_nulls = feature_c.copy()
        
        feature_a_with_nulls[null_indices_a] = np.nan
        feature_c_with_nulls[null_indices_c] = np.nan
        
        # Create DataFrame
        self.df_mock = pd.DataFrame({
            "feature_a": feature_a_with_nulls,
            "feature_b": feature_b,
            "feature_c": feature_c_with_nulls,
            "target": target
        })
        
        # Save to mock_data.csv
        self.csv_path = "mock_data.csv"
        self.df_mock.to_csv(self.csv_path, index=False)
        print(f"Generated synthetic dataset with {n_rows} rows and multicollinear features.")
        print(f"Total nulls injected: {self.df_mock.isnull().sum().sum()}")
        
        # Setup FastAPI TestClient
        self.client = TestClient(app)
        
        # Setup environment variables check
        # Verify if Vercel active env settings or equivalent are accessible
        self.env_url = os.getenv("SUPABASE_URL")
        self.env_key = os.getenv("SUPABASE_KEY")
        print(f"Database Config: {'Supabase Active' if (self.env_url and self.env_key) else 'SQLite Fallback Active'}")
        
    def tearDown(self):
        print("--- TEARING DOWN TEST ENVIRONMENT ---")
        # List of temporary files to clean up
        temp_files = [
            "mock_data.csv",
            "cleaned_dataset.csv",
            "cleaned_mock_data.csv",
            "metrics.json",
            "clean.csv"
        ]
        for f in temp_files:
            if os.path.exists(f):
                try:
                    os.remove(f)
                    print(f"Cleaned up file: {f}")
                except Exception as e:
                    print(f"Failed to delete {f}: {e}")
                    
        # Revert/delete other generated CSVs in workspace if any
        for f in os.listdir("."):
            if f.endswith("_mock_data.csv") or f.endswith("_sales.csv") or f.startswith("cleaned_"):
                if os.path.isfile(f):
                    try:
                        os.remove(f)
                        print(f"Cleaned up workspace file: {f}")
                    except:
                        pass

    def test_data_prep_imputation(self):
        print("\n--- TESTING DATA PREP IMPUTATION AND CLEANING ---")
        # Ensure we have nulls in mock data
        self.assertTrue(self.df_mock.isnull().any().any(), "Mock data should contain nulls before cleaning.")
        
        # Generate schema metadata columns info matching app expectations
        columns_info = {}
        for col in self.df_mock.columns:
            dtype_str = str(self.df_mock[col].dtype)
            columns_info[col] = {
                "dtype": dtype_str,
                "null_count": int(self.df_mock[col].isnull().sum()),
                "missing_pct": float((self.df_mock[col].isnull().sum() / len(self.df_mock)) * 100),
                "type": "numerical" if dtype_str in ['int64', 'float64'] else "categorical"
            }
            
        # Get data prep code from agent
        prep_res = run_data_prep_agent(self.csv_path, len(self.df_mock), columns_info, drop_features=[])
        self.assertIsNotNone(prep_res.code, "Data prep agent should produce executable cleaning code.")
        
        # Run generated data prep script via executor
        cleaned_path = "cleaned_mock_data.csv"
        exec_res = execute_code(
            prep_res.code,
            self.csv_path,
            output_files={"cleaned_dataset.csv": cleaned_path}
        )
        
        self.assertTrue(exec_res["success"], f"Executor failed to run data prep code. Stderr: {exec_res['stderr']}")
        
        # Verify output file exists and has zero nulls
        self.assertTrue(os.path.exists(cleaned_path), "Cleaned dataset CSV should be created.")
        cleaned_df = pd.read_csv(cleaned_path)
        null_count_after = cleaned_df.isnull().sum().sum()
        print(f"Null count in cleaned dataset: {null_count_after}")
        self.assertEqual(null_count_after, 0, "Imputation should remove all null values from the dataset.")

    def test_native_code_execution_tool(self):
        print("\n--- TESTING GOOGLE GENAI NATIVE TOOL SCHEMA ---")
        # Assert that the native types.Tool(code_execution=types.ToolCodeExecution()) compiles / instantiates correctly.
        tool = types.Tool(code_execution=types.ToolCodeExecution())
        self.assertIsNotNone(tool.code_execution, "types.Tool code_execution should be correctly instantiated.")
        self.assertTrue(hasattr(tool, "code_execution"), "types.Tool should have 'code_execution' attribute.")

    def test_statistical_judge_low_r2_self_correction(self):
        print("\n--- TESTING STATISTICAL JUDGE ROUTING ON LOW R2 ---")
        # Mock an unacceptably low R2 score payload (< 0.50)
        low_r2_metrics = {
            "r2": 0.45,
            "vifs": {
                "feature_a": 1.2,
                "feature_b": 1.2,
                "feature_c": 1.1
            },
            "coefficients": {
                "feature_a": 1.5,
                "feature_b": 0.2,
                "feature_c": -0.8
            },
            "intercept": 5.0,
            "silhouette": 0.35,
            "k_clusters": 3
        }
        
        # Run statistical judge
        judge_res = run_statistical_judge_agent(
            metrics=low_r2_metrics,
            stdout_logs="ML modeling script executed successfully.",
            self_correction_count=0
        )
        
        # Assert that judge rejects the run due to low R2 score
        self.assertFalse(judge_res.approved, "Judge should reject models with R2 score less than 0.60.")
        self.assertIn("R2", judge_res.critique, "Critique should mention R2 score violations.")
        
        # Simulate registration of trajectory in memory and self-correction routing check
        # (This replicates the orchestrator logic which increments correction counter when rejected)
        self_correction_count = 0
        if not judge_res.approved:
            self_correction_count += 1
            
        self.assertEqual(self_correction_count, 1, "Self-correction routing loop should trigger when model is rejected.")

    def test_api_upload_endpoint(self):
        print("\n--- TESTING POST /api/upload INTEGRATION ---")
        # Post valid CSV file payload
        with open(self.csv_path, "rb") as f:
            response = self.client.post(
                "/api/upload",
                files={"file": (self.csv_path, f, "text/csv")}
            )
            
        self.assertEqual(response.status_code, 200, f"Upload endpoint failed. Content: {response.text}")
        data = response.json()
        
        self.assertIn("dataset_id", data)
        self.assertEqual(data["file_name"], self.csv_path)
        self.assertEqual(data["row_count"], 100)
        self.assertIn("feature_a", data["columns"])

    def test_api_analyze_endpoint(self):
        print("\n--- TESTING POST /api/analyze INTEGRATION ---")
        # Post valid CSV file payload to analyze synchronously
        with open(self.csv_path, "rb") as f:
            response = self.client.post(
                "/api/analyze",
                files={"file": (self.csv_path, f, "text/csv")},
                data={"k_clusters": 3}
            )
            
        self.assertEqual(response.status_code, 200, f"Analyze endpoint failed. Content: {response.text}")
        data = response.json()
        
        # Assert response contains the exact dashboard state keys
        self.assertIn("metrics", data, "Payload must contain 'metrics' field.")
        self.assertIn("logs", data, "Payload must contain 'logs' field.")
        self.assertIn("markdown_report", data, "Payload must contain 'markdown_report' field.")
        
        print("Analyze endpoint payload keys verified successfully.")

    def test_error_resilience_boundaries(self):
        print("\n--- TESTING ERROR RESILIENCE BOUNDARIES ---")
        # Test Case A: Post corrupted/non-CSV file format text payload to /api/upload
        corrupted_content = "This is not a CSV file, it's just some plain text."
        response_upload = self.client.post(
            "/api/upload",
            files={"file": ("corrupted.txt", corrupted_content, "text/plain")}
        )
        # Should gracefully return HTTP 400 Bad Request
        self.assertEqual(response_upload.status_code, 400)
        self.assertIn("Only CSV files are supported", response_upload.json()["detail"])
        
        # Test Case B: Post corrupted/non-CSV file to /api/analyze
        response_analyze = self.client.post(
            "/api/analyze",
            files={"file": ("corrupted.txt", corrupted_content, "text/plain")}
        )
        self.assertEqual(response_analyze.status_code, 400)
        self.assertIn("Only CSV files are supported", response_analyze.json()["detail"])

if __name__ == "__main__":
    unittest.main()
