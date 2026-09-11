-- Supabase Database Schema DDL for Auto-Analyst AI

-- 1. Create Datasets Table
CREATE TABLE IF NOT EXISTS datasets (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    file_name TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    columns_json JSONB NOT NULL
);

-- 2. Create Pipeline Runs Table
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id UUID PRIMARY KEY,
    dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    run_status TEXT NOT NULL, -- 'pending', 'cleaning', 'modeling', 'validating', 'completed', 'failed'
    final_metrics JSONB
);

-- 3. Create Agent Logs Table (Audits)
CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY,
    run_id UUID REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    agent_name TEXT NOT NULL, -- 'data_prep', 'ml_modeler', 'statistical_judge', 'writer'
    raw_prompt TEXT NOT NULL,
    model_response TEXT NOT NULL,
    execution_code_used TEXT
);

-- 4. Disable Row Level Security (RLS) for API service key / anon access
ALTER TABLE datasets DISABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs DISABLE ROW LEVEL SECURITY;
