import os
import json
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# Check for Gemini API key
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
HAS_API_KEY = bool(GEMINI_API_KEY)

# Use gemini-1.5-flash as the default model (works on all developer API keys)
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# Define Pydantic response models for standard typing in python functions
class CodeAgentResponse(BaseModel):
    explanation: str = Field(description="Markdown explanation of what the script does and why this approach was chosen.")
    code: str = Field(description="Strictly valid, clean, and self-contained Python code block.")

class JudgeAgentResponse(BaseModel):
    approved: bool = Field(description="Whether the modeling results satisfy the statistical guidelines.")
    critique: str = Field(description="Detailed evaluation of R2, coefficients, multicollinearity VIFs, and cluster silhouette scores.")
    suggested_overrides: dict = Field(default_factory=dict, description="A dictionary of keys: 'drop_features' (list of strings to drop), 'k_clusters' (int), or 'add_polynomials' (bool).")

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
            description="Whether the modeling results satisfy the statistical guidelines (R2 >= 0.50, no severe multicollinearity)."
        ),
        "critique": types.Schema(
            type=types.Type.STRING,
            description="Detailed evaluation of R2, coefficients, multicollinearity VIFs, and cluster silhouette scores."
        ),
        "suggested_overrides": types.Schema(
            type=types.Type.OBJECT,
            description="A dictionary of keys: 'drop_features' (array of strings to drop), 'k_clusters' (integer)."
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

def get_mock_data_prep_code(columns_info, drop_features=None):
    drop_features = drop_features or []
    numeric_cols = [c for c, t in columns_info.items() if t in ("float64", "int64") and c not in drop_features]
    cat_cols = [c for c, t in columns_info.items() if t not in ("float64", "int64") and c not in drop_features]
    
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

# Impute missing values
for col in numeric_cols:
    if df[col].isnull().any():
        median_val = df[col].median()
        df[col] = df[col].fillna(median_val)
        print(f"Imputed missing in numeric '{{col}}' with median: {{median_val}}")

for col in cat_cols:
    if df[col].isnull().any():
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

def get_mock_modeling_code(features, target_col, k_clusters=3, drop_features=None):
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
    
    corr = X.corr().abs()
    high_corr_pairs = []
    for i in range(len(corr.columns)):
        for j in range(i):
            if corr.iloc[i, j] > 0.7:
                high_corr_pairs.append((corr.columns[i], corr.columns[j], float(corr.iloc[i, j])))
                
    coefficients = dict(zip(reg_features, [float(c) for c in model.coef_]))
    
    results["r2"] = float(r2)
    results["coefficients"] = coefficients
    results["intercept"] = float(model.intercept_)
    results["multicollinear_warnings"] = high_corr_pairs
    
    print(f"Linear Regression R2 Score: {{r2:.4f}}")
    print(f"Coefficients: {{coefficients}}")
    
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
        explanation="**Local Modeling Engine (Fallback)**: Fits a Multiple Linear Regression model predicting target from numeric features. Computes coefficients, residual plots, and correlation checks. Concurrently trains a K-Means clustering model and evaluates Silhouette metric.",
        code=code
    )

# Real LLM Agent Invocations

def run_data_prep_agent(file_name: str, row_count: int, columns_info: dict, drop_features=None) -> CodeAgentResponse:
    if not HAS_API_KEY:
        return get_mock_data_prep_code(columns_info, drop_features)
        
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
    3. Identify and impute missing values (fill missing numerical values with their median/mean, and categorical values with their mode or a separate 'missing' category).
    4. Apply `sklearn.preprocessing.StandardScaler` to scale all numerical columns except any identified ID/target columns, keeping column headers.
    5. Save the final cleaned dataframe to 'cleaned_dataset.csv' via `df.to_csv("cleaned_dataset.csv", index=False)`.
    6. Print a text summary of operations performed (e.g. shape changes, columns scaled, nulls imputed).
    
    Make sure your code does not contain any markdown block wrappers (like ```python) in the code field of the JSON. It must be valid executable python code.
    """
    
    try:
        response = client.models.generate_content(
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
    except Exception as e:
        print(f"Error in data_prep_agent API call: {e}. Falling back to mock.")
        return get_mock_data_prep_code(columns_info, drop_features)

def run_ml_modeling_agent(features: list, target_col: str, k_clusters: int = 3, drop_features=None) -> CodeAgentResponse:
    if not HAS_API_KEY:
        return get_mock_modeling_code(features, target_col, k_clusters, drop_features)
        
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
    7. Detect multicollinearity (compute simple pairwise correlations > 0.70 between features).
    8. VERY IMPORTANT: Save a JSON file named 'metrics.json' with keys:
       - 'r2' (float)
       - 'coefficients' (dict mapping features to floats)
       - 'intercept' (float)
       - 'silhouette' (float)
       - 'k_clusters' (int)
       - 'multicollinear_warnings' (list of lists representing correlation pairs: [col1, col2, corr_value])
    9. Print out the R2 score, coefficients, and silhouette score clearly.
    
    Make sure the python code is self-contained, robust, handles NaN checks, and writes 'metrics.json' correctly.
    """
    
    try:
        response = client.models.generate_content(
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
    except Exception as e:
        print(f"Error in ml_modeling_agent API call: {e}. Falling back to mock.")
        return get_mock_modeling_code(features, target_col, k_clusters, drop_features)

def run_statistical_judge_agent(metrics: dict, stdout_logs: str, self_correction_count: int) -> JudgeAgentResponse:
    if not HAS_API_KEY:
        r2 = metrics.get("r2", 0)
        collinear_pairs = metrics.get("multicollinear_warnings", [])
        approved = True
        critique = "Local Judge Evaluation:\n"
        suggested_overrides = {}
        
        if r2 < 0.50:
            approved = False
            critique += f"- R2 score is too low ({r2:.4f} < 0.50). Regression model fit is weak.\n"
        else:
            critique += f"- R2 score is acceptable ({r2:.4f} >= 0.50).\n"
            
        if collinear_pairs:
            approved = False
            critique += f"- Detected multicollinear feature pairs: {collinear_pairs}.\n"
            worst_col = collinear_pairs[0][0]
            suggested_overrides["drop_features"] = [worst_col]
        else:
            critique += "- No severe multicollinearity detected between features.\n"
            
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
    
    Your Evaluation Guidelines:
    1. If the R2 score is under 0.50, flag it.
    2. If there are multicollinearity indicators (high correlation pairs, coefficients with unexpected signs, or explicit warnings), flag it.
    3. If there are issues, set 'approved' to false. Provide a thorough 'critique' and suggest overrides in 'suggested_overrides' (e.g. key 'drop_features' containing list of features to drop, or 'k_clusters' to adjust).
    4. If metrics are healthy (R2 >= 0.50, low multicollinearity), set 'approved' to true.
    """
    
    try:
        response = client.models.generate_content(
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
    except Exception as e:
        print(f"Error in statistical_judge_agent API call: {e}. Falling back to rule-based.")
        r2 = metrics.get("r2", 0)
        collinear_pairs = metrics.get("multicollinear_warnings", [])
        approved = r2 >= 0.50 and not collinear_pairs
        critique = f"API Error fallback: approved={approved}. R2={r2:.4f}, collinearity={bool(collinear_pairs)}."
        suggested = {}
        if not approved and collinear_pairs:
            suggested["drop_features"] = [collinear_pairs[0][0]]
        return JudgeAgentResponse(approved=approved, critique=critique, suggested_overrides=suggested)

def run_writer_agent(dataset_name: str, row_count: int, initial_schema: dict, data_prep_summary: str, modeling_summary: str, metrics: dict, judge_critique: str) -> WriterAgentResponse:
    if not HAS_API_KEY:
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

*Report compiled by Auto-Analyst Writer Agent.*
"""
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
    3. Regression analysis explanation: translate the meaning of the Intercept and Coefficients (coefficients show the unit impact on target; explain this in business terms).
    4. Segmentation details: describe the clusters, silhouette value, and how groups are partitioned.
    5. Validation section: state the model's reliability based on the Judge's critique.
    6. Actionable recommendations based on the findings.
    
    Return the markdown text in the 'markdown_report' field.
    """
    
    try:
        response = client.models.generate_content(
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
    except Exception as e:
        print(f"Error in writer_agent API call: {e}. Falling back.")
        report = f"# Local Analysis Report fallback. API Error: {str(e)}"
        return WriterAgentResponse(markdown_report=report)
