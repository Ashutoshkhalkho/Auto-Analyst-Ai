import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  UploadCloud, 
  Terminal as TerminalIcon, 
  Archive, 
  Activity, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  TrendingUp, 
  Sliders, 
  Play, 
  FileText,
  AlertCircle,
  Sun,
  Moon
} from 'lucide-react';

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Theme State (Dark by default)
  const [theme, setTheme] = useState('dark');
  
  // Datasets State
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState(null);
  
  // Pipeline Settings
  const [targetCol, setTargetCol] = useState('');
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [kClusters, setKClusters] = useState(3);
  const [dropFeatures, setDropFeatures] = useState([]);
  
  // Active Run State
  const [activeRunId, setActiveRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('idle'); // idle, running, completed, failed
  const [selfCorrectionCount, setSelfCorrectionCount] = useState(0);
  const [activeStep, setActiveStep] = useState(null); // data_prep, ml_modeler, statistical_judge, writer
  const [stepStatuses, setStepStatuses] = useState({
    data_prep: 'idle',
    ml_modeler: 'idle',
    statistical_judge: 'idle',
    writer: 'idle'
  });
  
  // Streaming Logs State
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [plots, setPlots] = useState([]);
  const [agentOutputs, setAgentOutputs] = useState({
    data_prep: { explanation: '', code: '' },
    ml_modeler: { explanation: '', code: '' },
    statistical_judge: { explanation: '', code: '' },
    writer: { explanation: '', code: '' }
  });
  
  // History Logs & Archive State
  const [pipelineRuns, setPipelineRuns] = useState([]);
  const [selectedArchiveRun, setSelectedArchiveRun] = useState(null);
  
  // System metrics
  const [metrics, setMetrics] = useState({
    totalRuns: 0,
    avgR2: 0,
    activeTasks: 0,
    health: 'Online'
  });
  
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const socketRef = useRef(null);
  const terminalEndRef = useRef(null);

  // Sync theme with body class
  useEffect(() => {
    document.body.className = theme;
  }, [theme]);

  // Fetch initial data
  useEffect(() => {
    fetchDatasets();
    fetchRuns();
    fetchHealth();
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setMetrics(prev => ({
        ...prev,
        health: data.api_key_configured ? 'Online' : 'Mock-Engine Active (No API Key)'
      }));
    } catch (e) {
      setMetrics(prev => ({ ...prev, health: 'Offline' }));
    }
  };

  const fetchDatasets = async () => {
    try {
      const res = await fetch('/api/datasets');
      const data = await res.json();
      setDatasets(data);
      if (data.length > 0 && !selectedDataset) {
        handleSelectDataset(data[0]);
      }
    } catch (e) {
      setErrorMsg('Failed to load datasets.');
    }
  };

  const fetchRuns = async () => {
    try {
      const res = await fetch('/api/runs');
      const data = await res.json();
      setPipelineRuns(data);
      
      const completedRuns = data.filter(r => r.run_status === 'completed');
      const total = data.length;
      let r2Sum = 0;
      let r2Count = 0;
      completedRuns.forEach(r => {
        if (r.final_metrics && typeof r.final_metrics.r2 === 'number') {
          r2Sum += r.final_metrics.r2;
          r2Count++;
        }
      });
      
      setMetrics(prev => ({
        ...prev,
        totalRuns: total,
        avgR2: r2Count > 0 ? r2Sum / r2Count : 0.0,
        activeTasks: data.filter(r => ['pending', 'cleaning', 'modeling', 'validating'].includes(r.run_status)).length
      }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectDataset = (dataset) => {
    setSelectedDataset(dataset);
    
    const cols = Object.keys(dataset.columns_json || {});
    const numericCols = cols.filter(c => dataset.columns_json[c].type === 'numerical');
    if (numericCols.length > 0) {
      setTargetCol(numericCols[numericCols.length - 1]);
      setSelectedFeatures(cols.filter(c => c !== numericCols[numericCols.length - 1]));
    } else if (cols.length > 0) {
      setTargetCol(cols[0]);
      setSelectedFeatures(cols.slice(1));
    }
    setDropFeatures([]);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setIsUploading(true);
    setErrorMsg('');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Upload failed');
      }
      
      const newDataset = await res.json();
      await fetchDatasets();
      handleSelectDataset(newDataset);
      setActiveTab('dashboard');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to upload CSV file.');
    } finally {
      setIsUploading(false);
    }
  };

  const startPipelineRun = async () => {
    if (!selectedDataset) return;
    
    setErrorMsg('');
    setTerminalLogs([]);
    setPlots([]);
    setSelfCorrectionCount(0);
    setAgentOutputs({
      data_prep: { explanation: '', code: '' },
      ml_modeler: { explanation: '', code: '' },
      statistical_judge: { explanation: '', code: '' },
      writer: { explanation: '', code: '' }
    });
    setStepStatuses({
      data_prep: 'idle',
      ml_modeler: 'idle',
      statistical_judge: 'idle',
      writer: 'idle'
    });
    
    const requestData = {
      dataset_id: selectedDataset.id,
      target_col: targetCol,
      features: selectedFeatures.filter(f => !dropFeatures.includes(f)),
      k_clusters: kClusters,
      drop_features: dropFeatures
    };
    
    try {
      const res = await fetch('/api/start-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });
      
      if (!res.ok) throw new Error('Failed to initialize run');
      
      const runData = await res.json();
      const runId = runData.run_id;
      setActiveRunId(runId);
      setRunStatus('running');
      setActiveTab('terminal');
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/pipeline/${runId}`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;
      
      ws.onopen = () => {
        ws.send(JSON.stringify(requestData));
      };
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'state_update') {
          setActiveStep(msg.step);
          if (msg.step && msg.step !== 'completed' && msg.step !== 'self_correction') {
            setStepStatuses(prev => ({
              ...prev,
              [msg.step]: msg.status
            }));
          }
          if (msg.step === 'self_correction') {
            setSelfCorrectionCount(prev => prev + 1);
            setStepStatuses(prev => ({
              ...prev,
              ml_modeler: 'active',
              statistical_judge: 'idle'
            }));
          }
          setTerminalLogs(prev => [...prev, `[SYSTEM] [${msg.step?.toUpperCase() || 'INFO'}] ${msg.message}`]);
        }
        
        else if (msg.type === 'agent_message') {
          setAgentOutputs(prev => ({
            ...prev,
            [msg.agent]: {
              explanation: msg.explanation || '',
              code: msg.code || ''
            }
          }));
        }
        
        else if (msg.type === 'terminal_logs') {
          const combined = [];
          if (msg.stdout) combined.push(msg.stdout);
          if (msg.stderr) combined.push(`[ERROR] ${msg.stderr}`);
          if (combined.length > 0) {
            setTerminalLogs(prev => [...prev, ...combined]);
          }
        }
        
        else if (msg.type === 'plots') {
          setPlots(prev => [...prev, ...msg.plots]);
        }
        
        else if (msg.type === 'error') {
          setErrorMsg(msg.message);
          setRunStatus('failed');
        }
      };
      
      ws.onclose = () => {
        setRunStatus(prev => prev === 'running' ? 'completed' : prev);
        fetchRuns();
      };
      
    } catch (err) {
      setErrorMsg(err.message || 'Failed to start pipeline run.');
      setRunStatus('failed');
    }
  };

  const handleSelectArchiveRun = async (runId) => {
    try {
      const res = await fetch(`/api/runs/${runId}`);
      const data = await res.json();
      setSelectedArchiveRun(data);
    } catch (e) {
      setErrorMsg('Failed to load run details.');
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      
      {/* Sidebar Navigation */}
      <aside 
        style={{ backgroundColor: 'var(--sidebar)' }} 
        className="w-64 border-r border-[var(--border)] flex flex-col justify-between p-4 z-20"
      >
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="p-2 bg-[var(--accent)] rounded-lg flex items-center justify-center animate-pulse-glow">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base leading-none text-[var(--text)]">Auto-Analyst AI</h1>
              <span className="text-[10px] text-[var(--text-muted)] font-semibold tracking-wider uppercase">Multi-Agent Workspace</span>
            </div>
          </div>
          
          <nav className="space-y-1">
            <div 
              onClick={() => setActiveTab('dashboard')} 
              className={`sidebar-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Dashboard</span>
            </div>
            
            <div 
              onClick={() => setActiveTab('data_inspect')} 
              className={`sidebar-link ${activeTab === 'data_inspect' ? 'active' : ''}`}
            >
              <UploadCloud className="h-4 w-4" />
              <span>Upload & Inspection</span>
            </div>
            
            <div 
              onClick={() => setActiveTab('terminal')} 
              className={`sidebar-link ${activeTab === 'terminal' ? 'active' : ''}`}
            >
              <TerminalIcon className="h-4 w-4" />
              <span>Workflow Terminal</span>
              {runStatus === 'running' && (
                <span className="ml-auto w-2 h-2 rounded-full bg-[var(--accent)] animate-ping" />
              )}
            </div>
            
            <div 
              onClick={() => setActiveTab('archive')} 
              className={`sidebar-link ${activeTab === 'archive' ? 'active' : ''}`}
            >
              <Archive className="h-4 w-4" />
              <span>Reports Archive</span>
            </div>
          </nav>
        </div>
        
        {/* Connection status and health metrics */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--text-muted)] font-medium">System State</span>
            <div className="flex items-center gap-1.5">
              <span className={`status-dot green`} />
              <span className="font-semibold text-[var(--text)]">Active</span>
            </div>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate" title={metrics.health}>
            {metrics.health}
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[var(--background)]">
        
        {/* Top Header */}
        <header className="h-14 border-b border-[var(--border)] px-6 flex items-center justify-between bg-[var(--card)]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-[var(--text-muted)]">Current Dataset:</span>
            {selectedDataset ? (
              <span className="px-2.5 py-1 bg-[var(--background)] border border-[var(--border)] rounded text-xs font-semibold text-[var(--accent)] flex items-center gap-2">
                <FileText className="h-3 w-3" />
                {selectedDataset.file_name} ({selectedDataset.row_count} rows)
              </span>
            ) : (
              <span className="text-xs text-[var(--text-muted)] italic">No dataset uploaded yet</span>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {/* Theme Toggle Sun/Moon */}
            <button 
              onClick={toggleTheme}
              className="p-2 border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--border)] rounded-lg text-[var(--text)] transition cursor-pointer flex items-center justify-center"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />}
            </button>

            {selectedDataset && (
              <button 
                onClick={startPipelineRun} 
                disabled={runStatus === 'running'}
                className="flex items-center gap-2 px-4 py-1.5 bg-[var(--accent)] hover:opacity-90 disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] rounded-lg text-sm font-semibold text-white transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Start Worker Nodes
              </button>
            )}
          </div>
        </header>

        {/* Workspace Views */}
        <div className="flex-1 overflow-y-auto p-6 bg-[var(--background)]">
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-950/20 border border-[var(--error)]/30 rounded-lg text-[var(--error)] text-xs flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Dashboard View */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              
              {/* KPI metrics row */}
              <div className="dashboard-grid">
                <div className="glass-panel p-5 flex flex-col justify-between h-24">
                  <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">Total Pipelines Run</span>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-3xl font-bold tracking-tight text-[var(--text)]">{metrics.totalRuns}</span>
                    <Archive className="h-5 w-5 text-[var(--text-muted)]" />
                  </div>
                </div>
                
                <div className="glass-panel p-5 flex flex-col justify-between h-24">
                  <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">Average R² Score</span>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-3xl font-bold tracking-tight text-[var(--success)]">
                      {metrics.avgR2 > 0 ? metrics.avgR2.toFixed(3) : 'N/A'}
                    </span>
                    <TrendingUp className="h-5 w-5 text-[var(--success)]" />
                  </div>
                </div>
                
                <div className="glass-panel p-5 flex flex-col justify-between h-24">
                  <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">Active Worker Tasks</span>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-3xl font-bold tracking-tight text-[var(--accent)]">{metrics.activeTasks}</span>
                    <Sliders className="h-5 w-5 text-[var(--accent)]" />
                  </div>
                </div>
                
                <div className="glass-panel p-5 flex flex-col justify-between h-24">
                  <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">System Health Status</span>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-sm font-bold tracking-tight text-[var(--text)] truncate" title={metrics.health}>
                      {metrics.health.split(' ')[0]}
                    </span>
                    <span className={`status-dot green h-3 w-3`} />
                  </div>
                </div>
              </div>

              {/* Main Dual-Column Panel */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                
                {/* Left Column: Dropzone and Settings overrides */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="glass-panel p-5 space-y-4">
                    <h2 className="text-sm font-semibold text-[var(--text)] border-b border-[var(--border)] pb-2">Dataset Ingestion Dropzone</h2>
                    
                    {/* CSV Uploader */}
                    <div className="border border-dashed border-[var(--border)] hover:border-[var(--accent)] rounded-lg p-6 text-center cursor-pointer transition relative bg-[var(--background)] group">
                      <input 
                        type="file" 
                        accept=".csv" 
                        onChange={handleFileUpload} 
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        disabled={isUploading}
                      />
                      <div className="flex flex-col items-center gap-2">
                        {isUploading ? (
                          <RefreshCw className="h-8 w-8 text-[var(--accent)] animate-spinner" />
                        ) : (
                          <UploadCloud className="h-8 w-8 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition" />
                        )}
                        <div className="text-sm font-medium text-[var(--text)]">
                          {isUploading ? 'Analyzing CSV Column Matrices...' : 'Drag & Drop CSV file or click to browse'}
                        </div>
                        <span className="text-[10px] text-[var(--text-muted)]">Only standard comma-separated values (.csv) format</span>
                      </div>
                    </div>

                    {/* Features list dropdown / manual adjustments */}
                    {selectedDataset && (
                      <div className="space-y-4 pt-2">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-semibold text-[var(--text-muted)]">Target Feature Variable (Multiple Regression)</label>
                          <select 
                            value={targetCol} 
                            onChange={(e) => setTargetCol(e.target.value)}
                            className="w-full"
                          >
                            {Object.keys(selectedDataset.columns_json || {}).map(c => (
                              <option key={c} value={c}>
                                {c} ({selectedDataset.columns_json[c].type === 'numerical' ? 'Numeric' : 'Categorical'})
                              </option>
                            ))}
                          </select>
                        </div>
                        
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-semibold text-[var(--text-muted)]">K-Clusters Target (K-Means)</label>
                          <input 
                            type="number" 
                            min="2" 
                            max="10" 
                            value={kClusters} 
                            onChange={(e) => setKClusters(parseInt(e.target.value) || 3)}
                          />
                        </div>

                        {/* Checklist to manually drop features */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-[var(--text-muted)] flex items-center justify-between">
                            <span>Override Parameters (Drop Features)</span>
                            <span className="text-[10px] text-[var(--text-muted)] font-normal">Check columns to drop manually</span>
                          </label>
                          <div className="max-h-48 overflow-y-auto border border-[var(--border)] bg-[var(--background)] rounded-lg p-2 space-y-1">
                            {Object.keys(selectedDataset.columns_json || {}).map(colName => {
                              if (colName === targetCol) return null;
                              const isChecked = dropFeatures.includes(colName);
                              return (
                                <label key={colName} className="flex items-center gap-2 px-2 py-1 hover:bg-[var(--border)]/50 rounded text-xs cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setDropFeatures(prev => prev.filter(f => f !== colName));
                                      } else {
                                        setDropFeatures(prev => [...prev, colName]);
                                      }
                                    }}
                                    className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-0" 
                                  />
                                  <span className={isChecked ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text)]'}>
                                    {colName}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Dynamic Agent Execution Tree */}
                <div className="lg:col-span-3">
                  <div className="glass-panel p-5 h-full flex flex-col">
                    <h2 className="text-sm font-semibold text-[var(--text)] border-b border-[var(--border)] pb-2 mb-4">Agent Execution Flow Tree</h2>
                    
                    <div className="flex-1 flex flex-col justify-center py-6 px-4">
                      <div className="space-y-6 relative max-w-lg mx-auto w-full">
                        
                        {/* Dataset Node */}
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-[var(--card)] border border-[var(--border)] flex items-center justify-center font-bold text-xs text-[var(--text-muted)] shrink-0">
                            CSV
                          </div>
                          <div className="flex-1 p-3 bg.var(--card) border border-[var(--border)] rounded-lg">
                            <div className="text-xs font-semibold text-[var(--text)]">Raw Dataset Ingested</div>
                            <div className="text-[10px] text-[var(--text-muted)]">
                              {selectedDataset ? `${selectedDataset.file_name} Loaded` : 'Waiting for upload...'}
                            </div>
                          </div>
                        </div>

                        {/* Connector line */}
                        <div className="absolute left-5 top-8 w-[1px] h-[calc(100%-48px)] bg-[var(--border)] -z-10" />

                        {/* Data Prep Agent Node */}
                        <TreeNode 
                          title="Data Prep Agent (data_prep)"
                          desc="Cleans null columns and normalizes feature values via StandardScaler"
                          status={stepStatuses.data_prep}
                          active={activeStep === 'data_prep'}
                          log={agentOutputs.data_prep.explanation}
                          hasCode={!!agentOutputs.data_prep.code}
                        />

                        {/* ML Modeling Agent Node */}
                        <TreeNode 
                          title="ML Modeling Agent (ml_modeler)"
                          desc="Trains Multiple Linear Regression & K-Means algorithms, plots statistics"
                          status={stepStatuses.ml_modeler}
                          active={activeStep === 'ml_modeler'}
                          log={agentOutputs.ml_modeler.explanation}
                          hasCode={!!agentOutputs.ml_modeler.code}
                          retryCounter={selfCorrectionCount}
                        />

                        {/* Statistical Judge Agent Node */}
                        <TreeNode 
                          title="Statistical Judge Agent (statistical_judge)"
                          desc="LLM-as-a-judge VIF correlation evaluation. Rejects weak fits & VIF collinearity"
                          status={stepStatuses.statistical_judge}
                          active={activeStep === 'statistical_judge'}
                          log={agentOutputs.statistical_judge.explanation}
                        />

                        {/* Writer Agent Node */}
                        <TreeNode 
                          title="Writer Agent (writer)"
                          desc="Translates coefficients, centroids, and validation notes into a Markdown document"
                          status={stepStatuses.writer}
                          active={activeStep === 'writer'}
                          log={agentOutputs.writer.explanation}
                        />

                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* 2. Data Upload & Inspection View */}
          {activeTab === 'data_inspect' && (
            <div className="space-y-6">
              <div className="glass-panel p-5">
                <h2 className="text-sm font-semibold text-[var(--text)] border-b border-[var(--border)] pb-2 mb-4">Uploaded Datasets Archive</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {datasets.map(d => (
                    <div 
                      key={d.id} 
                      onClick={() => handleSelectDataset(d)}
                      className={`p-3.5 rounded-lg border text-left cursor-pointer transition flex items-start gap-3 ${selectedDataset?.id === d.id ? 'bg-[var(--card)] border-[var(--accent)] text-[var(--text)] shadow-sm' : 'bg-[var(--card)]/40 border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]/50'}`}
                    >
                      <FileText className={`h-5 w-5 ${selectedDataset?.id === d.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} mt-0.5`} />
                      <div className="space-y-1 truncate w-full">
                        <div className="text-xs font-semibold truncate text-[var(--text)]">{d.file_name}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Rows: {d.row_count} • Columns: {Object.keys(d.columns_json || {}).length}</div>
                        <div className="text-[10px] text-[var(--text-muted)]/70">{new Date(d.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                  {datasets.length === 0 && (
                    <div className="col-span-3 text-center py-6 text-xs text-[var(--text-muted)] italic">No datasets uploaded. Upload a CSV to begin.</div>
                  )}
                </div>
              </div>

              {selectedDataset && (
                <div className="glass-panel p-5 space-y-6">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text)] border-b border-[var(--border)] pb-2 mb-4">Dataset Columns & Base Statistics</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[var(--text-muted)] font-semibold">
                            <th className="py-2.5 px-3">Column Name</th>
                            <th className="py-2.5 px-3">Data Type</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Null Count</th>
                            <th className="py-2.5 px-3">Missing Value %</th>
                            <th className="py-2.5 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(selectedDataset.columns_json || {}).map(([colName, info]) => (
                            <tr key={colName} className="border-b border-[var(--border)]/40 hover:bg-[var(--border)]/20 transition">
                              <td className="py-2.5 px-3 font-semibold text-[var(--text)]">{colName}</td>
                              <td className="py-2.5 px-3 text-[var(--text-muted)] code-font">{info.dtype}</td>
                              <td className="py-2.5 px-3 capitalize">
                                <span className={`px-2 py-0.5 rounded text-[10px] ${info.type === 'numerical' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-900' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900'}`}>
                                  {info.type}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-[var(--text)]">{info.null_count}</td>
                              <td className="py-2.5 px-3 text-[var(--text)]">{info.missing_pct.toFixed(2)}%</td>
                              <td className="py-2.5 px-3">
                                {info.null_count > 0 ? (
                                  <span className="text-[var(--warning)] font-semibold">Needs Imputation</span>
                                ) : (
                                  <span className="text-[var(--success)] font-semibold">Clean</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. Workflow Terminal View */}
          {activeTab === 'terminal' && (
            <div className="h-[calc(100vh-170px)] flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text)]">Live Agent Pipeline Logs</h2>
                  <p className="text-[10px] text-[var(--text-muted)]">Live terminal logs from code executor & markdown compilation insights</p>
                </div>
                {runStatus === 'running' && (
                  <div className="flex items-center gap-2 text-xs text-[var(--accent)] font-semibold bg-[var(--accent-muted)] border border-[var(--border)] px-3 py-1 rounded-full">
                    <RefreshCw className="h-3 w-3 animate-spinner" />
                    <span>Executing Pipeline step: {activeStep?.toUpperCase().replace('_', ' ')}</span>
                  </div>
                )}
              </div>
              
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden">
                
                {/* Left Column: Code logs (terminal style) */}
                <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg flex flex-col overflow-hidden shadow-sm">
                  <div className="bg-[var(--background)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-2">
                      <TerminalIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
                      Python Subprocess Execution Output
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] code-font">stdout/stderr</span>
                  </div>
                  
                  {/* Logs stream body */}
                  <div className="flex-1 p-4 overflow-y-auto code-font text-xs space-y-1.5 bg-[var(--background)]/40 text-[var(--text)]">
                    {terminalLogs.map((log, idx) => {
                      let colorClass = 'text-[var(--text-muted)]';
                      if (log.startsWith('[SYSTEM]')) {
                        colorClass = 'text-[var(--accent)] font-semibold';
                      } else if (log.startsWith('[ERROR]') || log.startsWith('Execution Error') || log.startsWith('Execution Timeout')) {
                        colorClass = 'text-[var(--error)] font-semibold';
                      } else if (log.startsWith('Linear Regression R2') || log.startsWith('K-Means Silhouette')) {
                        colorClass = 'text-[var(--success)] font-semibold';
                      }
                      
                      return (
                        <div key={idx} className={colorClass}>
                          {log}
                        </div>
                      );
                    })}
                    {terminalLogs.length === 0 && (
                      <div className="text-[var(--text-muted)] italic">No output logged yet. Run a pipeline to stream logs.</div>
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                  
                  {/* Plots area in terminal */}
                  {plots.length > 0 && (
                    <div className="border-t border-[var(--border)] p-4 bg-[var(--card)] max-h-48 overflow-y-auto">
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-2 font-bold">Generated Figures</span>
                      <div className="flex gap-4">
                        {plots.map((base64Str, idx) => (
                          <div key={idx} className="border border-[var(--border)] rounded bg-white dark:bg-black p-1.5 shrink-0">
                            <img 
                              src={`data:image/png;base64,${base64Str}`} 
                              alt={`Pipeline Output Plot ${idx}`} 
                              className="h-28 rounded object-contain cursor-zoom-in"
                              onClick={() => {
                                const image = new Image();
                                image.src = `data:image/png;base64,${base64Str}`;
                                const w = window.open("");
                                w.document.write(image.outerHTML);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Markdown viewer (compiles agent statements) */}
                <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg flex flex-col overflow-hidden shadow-sm">
                  <div className="bg-[var(--background)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-[var(--success)]" />
                      Compiled Insight Translator Response
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] code-font">markdown</span>
                  </div>
                  
                  {/* Markdown content container */}
                  <div className="flex-1 p-5 overflow-y-auto text-xs space-y-4 prose prose-zinc dark:prose-invert max-w-none text-[var(--text)]">
                    {agentOutputs.writer.explanation ? (
                      <div className="space-y-4">
                        <div className="px-3 py-1 bg-emerald-100 dark:bg-emerald-950/40 border border-[var(--success)]/30 rounded text-[var(--success)] font-semibold inline-block">
                          Final Insight Report Generated
                        </div>
                        <div className="whitespace-pre-wrap leading-relaxed text-[var(--text)] font-sans text-sm">
                          {agentOutputs.writer.explanation}
                        </div>
                      </div>
                    ) : activeStep ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <span className="status-dot blue animate-ping" />
                          <span className="font-bold text-[var(--text)] uppercase">Streaming: {activeStep} Agent</span>
                        </div>
                        <div className="text-[var(--text-muted)] italic text-sm">
                          {agentOutputs[activeStep]?.explanation || 'Agent processing and generating analysis logs...'}
                        </div>
                        {agentOutputs[activeStep]?.code && (
                          <div className="mt-4 border border-[var(--border)] rounded-lg overflow-hidden">
                            <div className="bg-[var(--background)] text-[10px] text-[var(--text-muted)] px-3 py-1.5 border-b border-[var(--border)] code-font">Generated Script</div>
                            <pre className="bg-[var(--background)]/50 p-3 text-[11px] code-font overflow-x-auto text-[var(--accent)]">
                              {agentOutputs[activeStep].code}
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[var(--text-muted)] italic">Waiting for agents to broadcast markdown reports.</div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* 4. Reports Archive View */}
          {activeTab === 'archive' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left sidebar inside archive: list of runs */}
              <div className="glass-panel p-4 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--text)] border-b border-[var(--border)] pb-2">Completed Pipeline Runs</h2>
                <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
                  {pipelineRuns.map(run => (
                    <div 
                      key={run.id}
                      onClick={() => handleSelectArchiveRun(run.id)}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition space-y-2 ${selectedArchiveRun?.id === run.id ? 'bg-[var(--card)] border-[var(--accent)] text-[var(--text)] shadow-sm' : 'bg-[var(--card)]/40 border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]/50'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold truncate text-[var(--text)] max-w-[130px]">{run.file_name}</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${run.run_status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400 border border-[var(--success)]/40' : run.run_status === 'failed' ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-400 border border-[var(--error)]/40' : 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-400 border border-[var(--border)]'}`}>
                          {run.run_status}
                        </span>
                      </div>
                      
                      {run.final_metrics && typeof run.final_metrics.r2 === 'number' && (
                        <div className="text-[10px] text-[var(--text-muted)] flex items-center justify-between">
                          <span>Regression Fit:</span>
                          <span className="font-semibold text-[var(--success)]">R² = {run.final_metrics.r2.toFixed(3)}</span>
                        </div>
                      )}
                      
                      <div className="text-[9px] text-[var(--text-muted)]/75 flex justify-between">
                        <span>Run ID: {run.id.slice(0, 8)}...</span>
                        <span>{new Date(run.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                  {pipelineRuns.length === 0 && (
                    <div className="text-center py-6 text-xs text-[var(--text-muted)] italic">No historical runs recorded.</div>
                  )}
                </div>
              </div>

              {/* Right panel: details of selected run */}
              <div className="lg:col-span-2 glass-panel p-5">
                {selectedArchiveRun ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                      <div>
                        <h2 className="text-sm font-bold text-[var(--text)]">{selectedArchiveRun.dataset?.file_name || 'Unknown Dataset'}</h2>
                        <span className="text-[10px] text-[var(--text-muted)]">Run execution ID: {selectedArchiveRun.id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase ${selectedArchiveRun.run_status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400 border border-[var(--success)]/40' : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-400 border border-[var(--error)]/40'}`}>
                          {selectedArchiveRun.run_status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {/* Metadata boxes */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[var(--background)] p-3 rounded-lg border border-[var(--border)]">
                      <div className="text-center p-2 border-r border-[var(--border)]">
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">Fit (R²)</span>
                        <span className="text-sm font-bold text-[var(--success)]">
                          {selectedArchiveRun.final_metrics?.r2 !== undefined ? selectedArchiveRun.final_metrics.r2.toFixed(3) : 'N/A'}
                        </span>
                      </div>
                      <div className="text-center p-2 border-r border-[var(--border)]">
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">Silhouette</span>
                        <span className="text-sm font-bold text-[var(--accent)]">
                          {selectedArchiveRun.final_metrics?.silhouette !== undefined && selectedArchiveRun.final_metrics.silhouette !== null
                            ? selectedArchiveRun.final_metrics.silhouette.toFixed(3) 
                            : 'N/A'}
                        </span>
                      </div>
                      <div className="text-center p-2 border-r border-[var(--border)]">
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">K-Clusters</span>
                        <span className="text-sm font-bold text-[var(--text)]">
                          {selectedArchiveRun.final_metrics?.k_clusters || 'N/A'}
                        </span>
                      </div>
                      <div className="text-center p-2">
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">Self-Corrections</span>
                        <span className="text-sm font-bold text-[var(--warning)]">
                          {selectedArchiveRun.logs?.filter(l => l.agent_name === 'statistical_judge' && l.model_response.includes('approved": false')).length || 0}
                        </span>
                      </div>
                    </div>

                    {/* Show generated report inside archive details */}
                    <div className="space-y-3">
                      <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider block border-b border-[var(--border)] pb-1.5">Writer Insights Report</span>
                      <div className="bg-[var(--background)] p-5 rounded-lg border border-[var(--border)] max-h-[450px] overflow-y-auto font-sans text-sm text-[var(--text)] leading-relaxed whitespace-pre-wrap">
                        {selectedArchiveRun.logs?.find(l => l.agent_name === 'writer')?.model_response || 'No markdown insights found for this run.'}
                      </div>
                    </div>

                    {/* Show execution logs history list */}
                    <div className="space-y-3">
                      <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider block border-b border-[var(--border)] pb-1.5 font-sans">Pipeline Step Logs (Audits)</span>
                      <div className="space-y-2">
                        {selectedArchiveRun.logs?.map(log => (
                          <details key={log.id} className="bg-[var(--card)] border border-[var(--border)] rounded-lg group">
                            <summary className="p-3 text-xs font-semibold text-[var(--text)] cursor-pointer flex items-center justify-between hover:bg-[var(--border)]/20 transition select-none">
                              <span className="capitalize">{log.agent_name.replace('_', ' ')} Agent Log</span>
                              <span className="text-[10px] text-[var(--text-muted)]">{new Date(log.created_at).toLocaleTimeString()}</span>
                            </summary>
                            <div className="p-4 border-t border-[var(--border)] bg-[var(--background)]/35 text-xs space-y-3">
                              <div>
                                <span className="text-[9px] text-[var(--text-muted)] font-bold block mb-1">RAW PROMPT INJECTED:</span>
                                <div className="text-[var(--text-muted)] whitespace-pre-wrap font-sans bg-[var(--card)] p-2.5 rounded border border-[var(--border)] leading-normal">{log.raw_prompt}</div>
                              </div>
                              <div>
                                <span className="text-[9px] text-[var(--text-muted)] font-bold block mb-1">AGENT RESPONSE:</span>
                                <div className="text-[var(--text)] whitespace-pre-wrap font-sans bg-[var(--card)] p-2.5 rounded border border-[var(--border)] leading-normal">{log.model_response}</div>
                              </div>
                              {log.execution_code_used && (
                                <div>
                                  <span className="text-[9px] text-[var(--text-muted)] font-bold block mb-1">PYTHON CODE EXECUTED:</span>
                                  <pre className="p-2.5 bg-[var(--background)] text-[var(--accent)] rounded border border-[var(--border)] code-font text-[11px] overflow-x-auto">{log.execution_code_used}</pre>
                                </div>
                              )}
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-xs text-[var(--text-muted)] italic">Select a pipeline run on the left sidebar to view the report and audits.</div>
                )}
              </div>

            </div>
          )}
        </div>
      </main>

    </div>
  );
}

// Tree helper node
function TreeNode({ title, desc, status, active, log, hasCode, retryCounter }) {
  let statusIcon = <div className="w-2.5 h-2.5 rounded-full bg-zinc-400 dark:bg-zinc-650" />;
  let cardBorder = 'border-[var(--border)]';
  let pulseClass = '';
  
  if (status === 'active') {
    statusIcon = <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />;
    cardBorder = 'border-[var(--accent)]/50';
    pulseClass = 'animate-pulse-glow';
  } else if (status === 'running') {
    statusIcon = <RefreshCw className="h-3.5 w-3.5 text-[var(--accent)] animate-spinner" />;
    cardBorder = 'border-[var(--accent)]';
    pulseClass = 'animate-pulse-glow';
  } else if (status === 'success') {
    statusIcon = <CheckCircle className="h-4 w-4 text-[var(--success)] shrink-0" />;
    cardBorder = 'border-[var(--success)]/40';
  } else if (status === 'failed') {
    statusIcon = <XCircle className="h-4 w-4 text-[var(--error)] shrink-0" />;
    cardBorder = 'border-[var(--error)]/40';
  }
  
  if (active && status !== 'running') {
    cardBorder = 'border-[var(--accent)]/60';
    pulseClass = 'animate-pulse-glow';
  }

  return (
    <div className="flex items-start gap-4">
      <div className={`w-10 h-10 rounded-full bg-[var(--card)] border flex items-center justify-center relative z-10 shrink-0 ${active || status === 'running' ? 'border-[var(--accent)] shadow-sm' : 'border-[var(--border)]'}`}>
        {statusIcon}
      </div>
      
      <div className={`flex-1 p-3.5 bg-[var(--card)]/40 border rounded-lg transition-all ${cardBorder} ${pulseClass}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-[var(--text)]">{title}</span>
          <div className="flex items-center gap-1.5">
            {retryCounter > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-950/60 border border-amber-250 dark:border-amber-900 text-amber-700 dark:text-amber-400 rounded text-[9px] font-bold">
                Self-Correction Retry #{retryCounter}
              </span>
            )}
            {hasCode && (
              <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/60 border border-blue-250 dark:border-blue-900 text-blue-700 dark:text-blue-400 rounded text-[9px] font-medium code-font">
                code-block
              </span>
            )}
          </div>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] mt-1">{desc}</div>
        
        {log && (
          <div className="mt-2 text-[10px] text-[var(--text-muted)] bg-[var(--background)]/60 p-2 rounded border border-[var(--border)] line-clamp-2 hover:line-clamp-none transition-all leading-relaxed font-sans">
            {log}
          </div>
        )}
      </div>
    </div>
  );
}
