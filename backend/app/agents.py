import os
import json
import time
import random
import re
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from google.genai.errors import APIError
from dotenv import load_dotenv

load_dotenv()

# Check for Gemini API key
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
HAS_API_KEY = bool(GEMINI_API_KEY)

# Circuit breaker state to prevent slow agent hangs during 429 blocks
_last_429_timestamp = 0.0
CIRCUIT_BREAKER_COOLDOWN = 60.0  # Cooldown period in seconds

# Allow manual override for local-only execution
USE_LOCAL_ONLY = os.getenv("USE_LOCAL_ONLY", "false").lower() == "true"

def is_circuit_broken():
    global _last_429_timestamp
    if _last_429_timestamp > 0:
        elapsed = time.time() - _last_429_timestamp
        if elapsed < CIRCUIT_BREAKER_COOLDOWN:
            return True
    return False

def record_429():
    global _last_429_timestamp
    _last_429_timestamp = time.time()

def parse_retry_after(error_msg):
    match = re.search(r"please retry in ([\d\.]+)s", error_msg.lower())
    if match:
        return float(match.group(1))
    return None

def generate_content_with_retry(client, model, contents, config, max_retries=4):
    """
    Calls client.models.generate_content with exponential backoff on 429 rate limit errors.
    Bypasses calls if the circuit breaker is open (cooldown active) or local-only is enforced.
    """
    if USE_LOCAL_ONLY:
        print("USE_LOCAL_ONLY is enabled. Bypassing Gemini API call to run fallback local engine immediately.")
        raise Exception("USE_LOCAL_ONLY active. Bypassing API call.")
        
    if is_circuit_broken():
        print("Gemini API circuit breaker is OPEN (cooldown active). Bypassing API call to run fallback local engine immediately.")
        raise Exception("Gemini API rate limit cooldown active. Bypassing API call.")

    delay = 1.5
    for attempt in range(max_retries):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config
            )
        except APIError as e:
            if getattr(e, "code", None) == 429 or "quota" in str(e).lower() or "rate limit" in str(e).lower():
                record_429()  # Trip circuit breaker
                err_msg = str(e)
                retry_after = parse_retry_after(err_msg)
                
                # If the API tells us to wait more than 2 seconds, don't waste time retrying
                if retry_after and retry_after > 2.0:
                    print(f"Gemini API rate limit cooldown required: {retry_after:.2f}s. Tripping circuit breaker and bypassing retries.")
                    raise e
                    
                if attempt < max_retries - 1:
                    sleep_time = delay + random.uniform(0.1, 0.5)
                    print(f"Gemini API 429 Rate Limit hit. Retrying in {sleep_time:.2f}s (Attempt {attempt + 1}/{max_retries})...")
                    time.sleep(sleep_time)
                    delay *= 2.0
                    continue
            raise e

# Use gemini-1.5-flash as the default model (works on all developer API keys)
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# Native code execution tool setup matching the SDK syntax
# Note: In the google-genai SDK, CodeExecution is named ToolCodeExecution.
code_execution_tool = types.Tool(code_execution=types.ToolCodeExecution())

# Define Pydantic response models for standard typing in python functions
class CodeAgentResponse(BaseModel):
    explanation: str = Field(description="Markdown explanation of what the script does and why this approach was chosen.")
    code: str = Field(description="Strictly valid, clean, and self-contained Python code block.")

class JudgeAgentResponse(BaseModel):
    approved: bool = Field(description="Whether the modeling results satisfy the statistical guidelines.")
    critique: str = Field(description="Detailed evaluation of R2, VIF values, and code safety checks.")
    suggested_overrides: dict = Field(default_factory=dict, description="A dictionary of keys: 'drop_features' (list of strings to drop), 'syntax_error' (bool), or 'traceback' (str).")

class WriterAgentResponse(BaseModel):
    markdown_report: str = Field(description="A highly structured, premium business markdown report.")

# Define native Google GenAI Schemas to prevent 'additionalProperties' errors on Developer API keys
code_agent_schema = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "explanation": types.Schema(
            type=types.Type.STRING,
            description="Markdown explanation of what the script does and why this approach was chosen."
        ),
        "code": types.Schema(
            type=types.Type.STRING,
            description="Strictly valid, clean, and self-contained Python code block. Do NOT include markdown markers in this field."
        )
    },
    required=["explanation", "code"]
)

judge_agent_schema = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "approved": types.Schema(
            type=types.Type.BOOLEAN,
            description="Whether the modeling results satisfy the statistical guidelines (R2 >= 0.60, VIFs <= 5.0, no syntax errors)."
        ),
        "critique": types.Schema(
            type=types.Type.STRING,
            description="Detailed evaluation of R2, VIF values, and visual code safety checks."
        ),
        "suggested_overrides": types.Schema(
            type=types.Type.OBJECT,
            description="A dictionary of overrides. Example: {'drop_features': ['visits'], 'syntax_error': false}"
        )
    },
    required=["approved", "critique", "suggested_overrides"]
)

writer_agent_schema = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "markdown_report": types.Schema(
            type=types.Type.STRING,
            description="A highly structured, premium business markdown report summarizing findings, coefficients, cluster profiles, and actionable suggestions."
        )
    },
    required=["markdown_report"]
)

def get_genai_client():
    if HAS_API_KEY:
        return genai.Client(api_key=GEMINI_API_KEY)
    return None

# Mock generators for local testing without API keys

def get_mock_data_prep_code(columns_info, drop_features=None, refinement_prompt=None):
    drop_features = drop_features or []
    # If columns_info values are dictionaries, extract the dtype string.
    # Also support "numerical" as a type indicator.
    columns_dtypes = {}
    for c, val in columns_info.items():
        if isinstance(val, dict):
            columns_dtypes[c] = val.get("dtype", "object")
        elif val in ("numerical", "categorical"):
            columns_dtypes[c] = "float64" if val == "numerical" else "object"
        else:
            columns_dtypes[c] = str(val)
            
    numeric_cols = [c for c, t in columns_dtypes.items() if t in ("float64", "int64") and c not in drop_features]
    cat_cols = [c for c, t in columns_dtypes.items() if t not in ("float64", "int64") and c not in drop_features]
    
    code = f"""import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler

# Load dataset
df = pd.read_csv("dataset.csv")
print(f"Original shape: {{df.shape}}")

# Drop user-requested features
cols_to_drop = {drop_features}
cols_to_drop = [c for c in cols_to_drop if c in df.columns]
if cols_to_drop:
    df = df.drop(columns=cols_to_drop)
    print(f"Dropped features: {{cols_to_drop}}")

# Separate numerical and categorical columns
numeric_cols = {numeric_cols}
cat_cols = {cat_cols}

# Filter to actual columns present
numeric_cols = [c for c in numeric_cols if c in df.columns]
cat_cols = [c for c in cat_cols if c in df.columns]

# Coerce object columns that are mostly numeric (to handle typos like 'N/A', 'abc' in numbers)
for col in list(cat_cols):
    if col in df.columns and df[col].dtype == 'object':
        coerced = pd.to_numeric(df[col], errors='coerce')
        non_null_before = df[col].dropna().count()
        non_null_after = coerced.dropna().count()
        if non_null_before > 0 and (non_null_after / non_null_before) >= 0.5:
            df[col] = coerced
            print(f"Coerced column '{{col}}' to numeric (converted non-numeric typos to NaN)")
            if col not in numeric_cols:
                numeric_cols.append(col)
            if col in cat_cols:
                cat_cols.remove(col)

# Clean and clip numeric outliers (e.g. negative ages or placeholder 999999 values)
for col in numeric_cols:
    if col in df.columns:
        # Coerce to numeric if not already numeric (handles dirty numerical values)
        if not pd.api.types.is_numeric_dtype(df[col]):
            df[col] = pd.to_numeric(df[col], errors='coerce')
            print(f"Coerced numeric column '{{col}}' to float64 (non-numeric values became NaN)")
            
        # Impute missing values with median first
        median_val = df[col].median()
        if pd.isnull(median_val):
            median_val = 0.0
        df[col] = df[col].fillna(median_val)
        
        # Clip outliers using IQR (1.5 * IQR) boundary capping
        q25 = df[col].quantile(0.25)
        q75 = df[col].quantile(0.75)
        iqr = q75 - q25
        lower_bound = q25 - 1.5 * iqr
        upper_bound = q75 + 1.5 * iqr
        df[col] = df[col].clip(lower=lower_bound, upper=upper_bound)
        print(f"Imputed and capped outliers in numeric '{{col}}' to [{{lower_bound:.2f}}, {{upper_bound:.2f}}]")

# Impute categorical columns with mode
for col in cat_cols:
    if col in df.columns and df[col].isnull().any():
        mode_val = df[col].mode().iloc[0] if not df[col].mode().empty else "missing"
        df[col] = df[col].fillna(mode_val)
        print(f"Imputed missing in categorical '{{col}}' with mode: {{mode_val}}")

# Scale numerical columns
if numeric_cols:
    scaler = StandardScaler()
    df[numeric_cols] = scaler.fit_transform(df[numeric_cols])
    print(f"Scaled numeric columns: {{numeric_cols}}")

# Save cleaned dataset
df.to_csv("cleaned_dataset.csv", index=False)
print(f"Saved cleaned dataset with shape {{df.shape}} to cleaned_dataset.csv")
"""
    return CodeAgentResponse(
        explanation="**Local Preprocessing Engine (Fallback)**: Imputes missing numerical values with their median and categorical values with their mode. Applies a standard scaler to normalize numerical feature matrices.",
        code=code
    )

def get_mock_modeling_code(features, target_col, k_clusters=3, drop_features=None, refinement_prompt=None):
    drop_features = drop_features or []
    features = [f for f in features if f != target_col and f not in drop_features]
    
    code = f"""import pandas as pd
import numpy as np
import json
import matplotlib.pyplot as plt
from sklearn.linear_model import LinearRegression
from sklearn.cluster import KMeans
from sklearn.metrics import r2_score, silhouette_score

# Load cleaned dataset
df = pd.read_csv("cleaned_dataset.csv")

# Select features and target present in dataset
features = [f for f in {features} if f in df.columns]
target = "{target_col}"

results = {{}}

# 1. Multiple Linear Regression
# Filter features to only numeric features to avoid ValueError in scikit-learn
reg_features = [f for f in features if df[f].dtype in [np.float64, np.int64]]
if target in df.columns and len(reg_features) > 0:
    df_reg = df[[target] + reg_features].dropna()
    X = df_reg[reg_features]
    y = df_reg[target]
    
    model = LinearRegression()
    model.fit(X, y)
    
    y_pred = model.predict(X)
    r2 = r2_score(y, y_pred)
    
    # Calculate Variance Inflation Factors (VIFs) using Linear Regression
    vifs = {{}}
    multicollinear_warnings = []
    for col in reg_features:
        cols_except_col = [c for c in reg_features if c != col]
        if len(cols_except_col) > 0:
            r_model = LinearRegression()
            r_model.fit(X[cols_except_col], X[col])
            r2_j = r_model.score(X[cols_except_col], X[col])
            vif = 1.0 / (1.0 - r2_j) if r2_j < 1.0 else 999.0
            vifs[col] = float(vif)
            if vif > 5.0:
                multicollinear_warnings.append(col)
        else:
            vifs[col] = 1.0
            
    coefficients = dict(zip(reg_features, [float(c) for c in model.coef_]))
    
    results["r2"] = float(r2)
    results["coefficients"] = coefficients
    results["intercept"] = float(model.intercept_)
    results["vifs"] = vifs
    results["multicollinear_warnings"] = [[col, "VIF", vifs[col]] for col in multicollinear_warnings]
    
    print(f"Linear Regression R2 Score: {{r2:.4f}}")
    print(f"Coefficients: {{coefficients}}")
    print(f"Calculated VIFs: {{vifs}}")
    
    plt.figure()
    plt.scatter(y_pred, y - y_pred, alpha=0.5)
    plt.axhline(0, color='red', linestyle='--')
    plt.title("Residual vs Predicted Plot")
    plt.xlabel("Predicted Values")
    plt.ylabel("Residuals")
    plt.show()
else:
    print("Linear Regression skipped: target or features missing.")
    results["r2"] = 0.0
    results["coefficients"] = {{}}
    results["intercept"] = 0.0
    results["vifs"] = {{}}
    results["multicollinear_warnings"] = []

# 2. K-Means Clustering
k = {k_clusters}
cluster_features = [f for f in features if df[f].dtype in [np.float64, np.int64]]
if len(cluster_features) >= 2:
    X_clust = df[cluster_features]
    kmeans = KMeans(n_clusters=k, random_state=42, n_init='auto')
    df['cluster'] = kmeans.fit_predict(X_clust)
    
    sil = silhouette_score(X_clust, df['cluster'])
    results["silhouette"] = float(sil)
    results["k_clusters"] = k
    results["cluster_sizes"] = df['cluster'].value_counts().to_dict()
    
    print(f"K-Means Silhouette Score: {{sil:.4f}}")
    print(f"Cluster sizes: {{results['cluster_sizes']}}")
    
    plt.figure()
    scatter = plt.scatter(df[cluster_features[0]], df[cluster_features[1]], c=df['cluster'], cmap='viridis', alpha=0.6)
    plt.title(f"K-Means Clustering (k={{k}})")
    plt.xlabel(cluster_features[0])
    plt.ylabel(cluster_features[1])
    plt.colorbar(scatter, label="Cluster")
    plt.show()
else:
    print("K-Means skipped: not enough numeric features.")
    results["silhouette"] = 0.0
    results["k_clusters"] = 0
    results["cluster_sizes"] = {{}}

with open("metrics.json", "w") as f:
    json.dump(results, f, indent=4)
print("Saved model metrics to metrics.json")
"""
    return CodeAgentResponse(
        explanation="**Local Modeling Engine (Fallback)**: Fits a Multiple Linear Regression model predicting target from numeric features. Computes VIFs to guard against multicollinearity (>5.0). Concurrently trains a K-Means clustering model.",
        code=code
    )

# Real LLM Agent Invocations

def run_data_prep_agent(file_name: str, row_count: int, columns_info: dict, drop_features=None, refinement_prompt=None) -> CodeAgentResponse:
    if not HAS_API_KEY:
        return get_mock_data_prep_code(columns_info, drop_features, refinement_prompt)
        
    client = get_genai_client()
    prompt = f"""
    You are the 'data_prep_agent' in a multi-agent system.
    Your task is to write a single executable Python script to clean and prepare a dataset.
    The uploaded dataset is named '{file_name}' and contains {row_count} rows.
    Here is the column schema information (column name: data type, null count, missing %):
    {json.dumps(columns_info, indent=2)}
    
    User overrides:
    Features to drop manually: {drop_features or []}
    
    Your Python code MUST:
    1. Read 'dataset.csv' into a pandas DataFrame: `df = pd.read_csv("dataset.csv")`.
    2. Drop any columns requested in the features to drop manually.
    3. Identify and handle dirty numerical columns: For any categorical/object columns that contain mostly numeric values (e.g. Age with 'N/A' or purchase_amount with 'abc'), coerce them using `pd.to_numeric(df[col], errors='coerce')` so they can be processed numerically.
    4. Impute missing values (fill missing numerical values with their median, and categorical values with their mode or a separate 'missing' category).
    5. Clean outliers in numerical columns by clipping them to the 1st and 99th percentiles.
    6. Apply `sklearn.preprocessing.StandardScaler` to scale all numerical columns except any identified ID/target columns, keeping column headers.
    7. Save the final cleaned dataframe to 'cleaned_dataset.csv' via `df.to_csv("cleaned_dataset.csv", index=False)`.
    8. Print a text summary of operations performed (e.g. shape changes, columns scaled, nulls imputed).
    
    Make sure your code does not contain any markdown block wrappers (like ```python) in the code field of the JSON. It must be valid executable python code.
    """

    if refinement_prompt:
        prompt += f"\n\n=== PROGRESSIVE REFINEMENT FEEDBACK ===\n{refinement_prompt}\nPlease repair the script based on this feedback.\n"
    
    try:
        response = generate_content_with_retry(
            client=client,
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=code_agent_schema,
                temperature=0.1
            )
        )
        data = json.loads(response.text)
        return CodeAgentResponse(**data)
    except APIError as e:
        print(f"GenAI API Error in data_prep_agent (code={e.code}, message={e.message}). Falling back to mock.")
        return get_mock_data_prep_code(columns_info, drop_features, refinement_prompt)
    except Exception as e:
        print(f"Unexpected error in data_prep_agent API call: {e}. Falling back to mock.")
        return get_mock_data_prep_code(columns_info, drop_features, refinement_prompt)

def run_ml_modeling_agent(features: list, target_col: str, k_clusters: int = 3, drop_features=None, temperature: float = 0.1, refinement_prompt=None) -> CodeAgentResponse:
    if not HAS_API_KEY:
        return get_mock_modeling_code(features, target_col, k_clusters, drop_features, refinement_prompt)
        
    client = get_genai_client()
    features = [f for f in features if f != target_col and f not in (drop_features or [])]
    
    prompt = f"""
    You are the 'ml_modeling_agent' in a multi-agent system.
    Your task is to write a single executable Python script to perform statistical modeling.
    The cleaned dataset is located at 'cleaned_dataset.csv'.
    
    Model configuration:
    - Features to use: {features}
    - Target column (for Multiple Linear Regression): {target_col}
    - Number of clusters (for K-Means): {k_clusters}
    
    Your Python code MUST:
    1. Read 'cleaned_dataset.csv'.
    2. Fit a Multiple Linear Regression model from `sklearn.linear_model.LinearRegression` to predict the target. VERY IMPORTANT: If any of the features to use are categorical (non-numeric), one-hot encode them using `pd.get_dummies(..., drop_first=True)` or filter them out to prevent ValueError in scikit-learn.
    3. Generate a residuals vs predicted values scatter plot using matplotlib/seaborn and show it with `plt.show()` (which will be intercepted).
    4. Fit a K-Means clustering model from `sklearn.cluster.KMeans` using all numeric features. Use k = {k_clusters}.
    5. Generate a scatter plot of the clusters using the first two numeric features and show it with `plt.show()`.
    6. Calculate the R2 score for regression, model coefficients, intercept, and silhouette score for clustering.
    7. Detect multicollinearity using Variance Inflation Factors (VIF) for all regression features. Do NOT import statsmodels. Instead, compute VIF for each feature using scikit-learn's LinearRegression by regressing that feature against all other features (VIF = 1 / (1 - R2)).
    8. VERY IMPORTANT: Save a JSON file named 'metrics.json' with keys:
       - 'r2' (float)
       - 'coefficients' (dict mapping features to floats)
       - 'intercept' (float)
       - 'silhouette' (float)
       - 'k_clusters' (int)
       - 'vifs' (dict mapping features to floats)
       - 'multicollinear_warnings' (list of features exceeding VIF 5.0)
    9. Print out the R2 score, coefficients, VIF values, and silhouette score clearly.
    
    Make sure the python code is self-contained, robust, handles NaN checks, and writes 'metrics.json' correctly.
    """

    if refinement_prompt:
        prompt += f"\n\n=== PROGRESSIVE REFINEMENT FEEDBACK ===\n{refinement_prompt}\nPlease repair the script based on this feedback.\n"
    
    try:
        response = generate_content_with_retry(
            client=client,
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=code_agent_schema,
                temperature=temperature
            )
        )
        data = json.loads(response.text)
        return CodeAgentResponse(**data)
    except APIError as e:
        print(f"GenAI API Error in ml_modeling_agent (code={e.code}, message={e.message}). Falling back to mock.")
        return get_mock_modeling_code(features, target_col, k_clusters, drop_features, refinement_prompt)
    except Exception as e:
        print(f"Unexpected error in ml_modeling_agent API call: {e}. Falling back to mock.")
        return get_mock_modeling_code(features, target_col, k_clusters, drop_features, refinement_prompt)

def run_statistical_judge_agent(metrics: dict, stdout_logs: str, self_correction_count: int) -> JudgeAgentResponse:
    if not HAS_API_KEY:
        r2 = metrics.get("r2", 0)
        vifs = metrics.get("vifs", {})
        high_vifs = [col for col, val in vifs.items() if val > 5.0]
        
        approved = r2 >= 0.60 and len(high_vifs) == 0
        critique = "Local Judge Evaluation:\n"
        suggested_overrides = {}
        
        if r2 < 0.60:
            approved = False
            critique += f"- R2 score is too low ({r2:.4f} < 0.60). Regression model fit is weak.\n"
        else:
            critique += f"- R2 score is acceptable ({r2:.4f} >= 0.60).\n"
            
        if high_vifs:
            approved = False
            highest_vif_col = max(high_vifs, key=lambda c: vifs[c])
            critique += f"- Detected multicollinear features with VIF > 5.0: {high_vifs}. Suggesting dropping the highest VIF feature: {highest_vif_col} ({vifs[highest_vif_col]:.2f}).\n"
            suggested_overrides["drop_features"] = [highest_vif_col]
        else:
            critique += "- No severe multicollinearity (VIF > 5.0) detected between features.\n"
            
        if approved:
            critique += "Run approved! All criteria satisfied."
        else:
            critique += f"Self-correction loop triggered (Attempt {self_correction_count + 1})."
            
        return JudgeAgentResponse(
            approved=approved,
            critique=critique,
            suggested_overrides=suggested_overrides
        )
        
    client = get_genai_client()
    prompt = f"""
    You are the 'statistical_judge_agent' in a multi-agent system.
    Evaluate the statistical validity of the following machine learning modeling run.
    
    Model Performance Metrics:
    {json.dumps(metrics, indent=2)}
    
    Execution Output Logs:
    {stdout_logs}
    
    Current self-correction loop counter: {self_correction_count}
    
    Your Evaluation Guidelines (Dual-Stage Verification):
    
    STAGE 1: Code Safety & Syntax
    - Inspect the logs for execution halts, tracebacks, syntax errors, or package import conflicts.
    - If a code execution error occurred, set approved = False, note "syntax_error" in overrides, and pass the traceback in critique.
    
    STAGE 2: Statistical Boundary Analysis
    - Check the Multiple Linear Regression metrics:
      * If R2 is less than 0.60, mark approved = False.
      * If any feature's Variance Inflation Factor (VIF) exceeds 5.0, mark approved = False. Identify the single feature with the highest VIF value and explicitly list only that feature in 'suggested_overrides' as a list of strings: {{"drop_features": ["highest_vif_feature_name"]}}. Do not drop all high VIF features at once; drop them one-by-one per iteration.
    - If metrics are healthy (R2 >= 0.60, VIFs <= 5.0, no errors), mark approved = True.
    """
    
    try:
        response = generate_content_with_retry(
            client=client,
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=judge_agent_schema,
                temperature=0.2
            )
        )
        data = json.loads(response.text)
        return JudgeAgentResponse(**data)
    except APIError as e:
        print(f"GenAI API Error in statistical_judge_agent (code={e.code}, message={e.message}). Falling back to rule-based.")
        r2 = metrics.get("r2", 0)
        vifs = metrics.get("vifs", {})
        high_vifs = [col for col, val in vifs.items() if val > 5.0]
        approved = r2 >= 0.60 and len(high_vifs) == 0
        critique = f"API Error fallback: approved={approved}. R2={r2:.4f}, high_vifs={high_vifs}."
        suggested = {}
        if not approved and high_vifs:
            highest_vif_col = max(high_vifs, key=lambda c: vifs[c])
            suggested["drop_features"] = [highest_vif_col]
        return JudgeAgentResponse(approved=approved, critique=critique, suggested_overrides=suggested)
    except Exception as e:
        print(f"Unexpected error in statistical_judge_agent API call: {e}. Falling back to rule-based.")
        r2 = metrics.get("r2", 0)
        vifs = metrics.get("vifs", {})
        high_vifs = [col for col, val in vifs.items() if val > 5.0]
        approved = r2 >= 0.60 and len(high_vifs) == 0
        critique = f"API Error fallback: approved={approved}. R2={r2:.4f}, high_vifs={high_vifs}."
        suggested = {}
        if not approved and high_vifs:
            highest_vif_col = max(high_vifs, key=lambda c: vifs[c])
            suggested["drop_features"] = [highest_vif_col]
        return JudgeAgentResponse(approved=approved, critique=critique, suggested_overrides=suggested)

def generate_local_fallback_report(dataset_name: str, row_count: int, data_prep_summary: str, modeling_summary: str, metrics: dict, judge_critique: str) -> str:
    report = f"""# Auto-Analyst AI Statistical Report: {dataset_name}

## Executive Summary
This report analyzes the dataset **{dataset_name}** containing **{row_count}** observations. A multi-agent statistical pipeline performed data preprocessing, Multiple Linear Regression, and K-Means clustering.

## Data Preprocessing
- **Cleaned Data Scope**: Imputed missing fields using median and mode. Applied Z-score scaling.
- **Notes**: {data_prep_summary}

## Regression Insights
- **Target Variable**: Predicted using regression models.
- **R² Fit Score**: `{metrics.get('r2', 0.0):.4f}`
- **Intercept**: `{metrics.get('intercept', 0.0):.4f}`
- **Coefficients**:
"""
    for feature, coef in metrics.get("coefficients", {}).items():
        report += f"  - **{feature}**: `{coef:.4f}`\n"
        
    report += f"""
## Segmentation Analysis (K-Means)
- **Number of Clusters**: `{metrics.get('k_clusters', 0)}`
- **Silhouette Score**: `{metrics.get('silhouette', 0.0):.4f}`

## Judge & Quality Validation
{judge_critique}

*Report compiled by Auto-Analyst Writer Agent (Local Fallback Mode).*
"""
    return report

def run_writer_agent(dataset_name: str, row_count: int, initial_schema: dict, data_prep_summary: str, modeling_summary: str, metrics: dict, judge_critique: str) -> WriterAgentResponse:
    if not HAS_API_KEY or USE_LOCAL_ONLY or is_circuit_broken():
        report = generate_local_fallback_report(dataset_name, row_count, data_prep_summary, modeling_summary, metrics, judge_critique)
        return WriterAgentResponse(markdown_report=report)
        
    client = get_genai_client()
    prompt = f"""
    You are the 'writer_agent' in a multi-agent system.
    Translate the mathematical outputs and metrics of a data science modeling pipeline into a stunning, executive business report in Markdown.
    
    Dataset details:
    - Name: {dataset_name}
    - Row Count: {row_count}
    - Initial columns: {list(initial_schema.keys())}
    
    Operations details:
    - Data Preprocessing Log: {data_prep_summary}
    - Modeling Log: {modeling_summary}
    - Final Metrics: {json.dumps(metrics, indent=2)}
    - Statistical Judge Review: {judge_critique}
    
    Your Report MUST Include:
    1. A beautiful layout with clear headers.
    2. Executive Summary detailing what the statistical modeling reveals about the dataset.
    3. Regression analysis explanation: translate the meaning of the Intercept and Coefficients (coefficients show the unit impact on target; explain this in business terms). Include calculated VIFs and note if multicollinearity was resolved.
    4. Segmentation details: describe the clusters, silhouette value, and how groups are partitioned.
    5. Validation section: state the model's reliability based on the Judge's critique.
    6. Actionable recommendations based on the findings.
    
    Return the markdown text in the 'markdown_report' field.
    """
    
    try:
        response = generate_content_with_retry(
            client=client,
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=writer_agent_schema,
                temperature=0.3
            )
        )
        data = json.loads(response.text)
        return WriterAgentResponse(**data)
    except APIError as e:
        print(f"GenAI API Error in writer_agent (code={e.code}, message={e.message}). Falling back to rule-based report.")
        report = generate_local_fallback_report(dataset_name, row_count, data_prep_summary, modeling_summary, metrics, judge_critique)
        report += f"\n\n*(Note: Fallback triggered due to API Cooldown / Error: {e.message})*"
        return WriterAgentResponse(markdown_report=report)
    except Exception as e:
        print(f"Unexpected error in writer_agent API call: {e}. Falling back to rule-based report.")
        report = generate_local_fallback_report(dataset_name, row_count, data_prep_summary, modeling_summary, metrics, judge_critique)
        report += f"\n\n*(Note: Fallback triggered due to Unexpected Error: {str(e)})*"
        return WriterAgentResponse(markdown_report=report)
