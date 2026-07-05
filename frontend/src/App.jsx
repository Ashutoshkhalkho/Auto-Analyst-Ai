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
  Moon,
  Database,
  Settings,
  Search,
  ExternalLink,
  FileCode,
  ChevronRight
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
    avgR2: 0.84, // Default placeholder from mockup
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
        health: data.api_key_configured ? 'Supabase Active' : 'SQLite Fallback Active'
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
        avgR2: r2Count > 0 ? r2Sum / r2Count : 0.84, // Fallback to mockup value if 0
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
      setActiveTab('dashboard');
      
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

  const parseMathAndSubscripts = (str) => {
    try {
      if (!str) return '';
      
      let processedStr = str.replace(/R²/g, "R^2").replace(/R₂/g, "R_2");
      const matchRegex = /([a-zA-Z0-9\\beta\\alpha\\gamma\\theta\\]+)(_|\^)([a-zA-Z0-9{}]+)/;
      
      const parts = processedStr.split(/([a-zA-Z0-9\\beta\\alpha\\gamma\\theta\\]+[_^][a-zA-Z0-9{}]+)/);
      return parts.map((part, index) => {
        const subMatch = part.match(matchRegex);
        if (subMatch) {
          const base = subMatch[1];
          const op = subMatch[2];
          const val = subMatch[3].replace(/[{}]/g, "");
          
          return (
            <span key={index}>
              {base}
              {op === '_' ? <sub>{val}</sub> : <sup>{val}</sup>}
            </span>
          );
        }
        return part;
      });
    } catch (e) {
      console.error("Math parsing error", e);
      return str;
    }
  };

  const parseInlines = (text) => {
    const parts = text.split("**");
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <strong key={i} className="font-bold text-slate-900 dark:text-slate-900">{parseMathAndSubscripts(part)}</strong>;
      }
      const codeParts = part.split("`");
      return codeParts.map((subPart, j) => {
        if (j % 2 === 1) {
          return <code key={j} className="bg-slate-100 text-slate-800 font-mono px-1 py-0.5 rounded text-[10px]">{subPart}</code>;
        }
        return parseMathAndSubscripts(subPart);
      });
    });
  };

  const renderMarkdown = (text) => {
    if (!text) return <p className="text-slate-400 italic text-xs">No analysis report generated yet.</p>;
    
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      if (line.startsWith("# ")) {
        return <h1 key={idx} className="text-xl font-bold text-slate-800 border-b-2 border-slate-200 pb-2 mt-4 mb-3 uppercase tracking-tight">{line.replace("# ", "")}</h1>;
      }
      if (line.startsWith("## ")) {
        return <h2 key={idx} className="text-md font-bold text-slate-800 border-l-4 border-blue-500 pl-3 mt-4 mb-2">{line.replace("## ", "")}</h2>;
      }
      if (line.startsWith("### ")) {
        return <h3 key={idx} className="text-sm font-semibold text-slate-700 mt-3 mb-1.5">{line.replace("### ", "")}</h3>;
      }
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        return (
          <li key={idx} className="ml-4 list-disc text-sm text-slate-700 mb-1 leading-relaxed">
            {parseInlines(line.trim().substring(2))}
          </li>
        );
      }
      if (line.trim() === "") {
        return <div key={idx} className="h-2"></div>;
      }
      return <p key={idx} className="text-sm text-slate-700 mb-2 leading-relaxed">{parseInlines(line)}</p>;
    });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-on-surface select-none">
      
      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 h-full w-[250px] bg-surface-container border-r border-outline-variant flex flex-col py-unit-lg z-50">
        <div className="px-unit-md mb-unit-xl">
          <h1 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Auto-Analyst AI
          </h1>
          <p className="font-label-mono text-[10px] text-outline uppercase tracking-widest mt-1">Enterprise Analytics</p>
        </div>
        
        <nav className="flex-1 flex flex-col gap-1">
          <div 
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-unit-md px-unit-md py-unit-sm transition-colors duration-200 cursor-pointer ${
              activeTab === 'dashboard' ? 'text-primary border-l-2 border-primary bg-primary-container/10' : 'text-on-surface-variant hover:bg-surface-variant'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="font-label-mono text-label-mono">Workspace</span>
          </div>
          
          <div 
            onClick={() => setActiveTab('archive')}
            className={`flex items-center gap-unit-md px-unit-md py-unit-sm transition-colors duration-200 cursor-pointer ${
              activeTab === 'archive' ? 'text-primary border-l-2 border-primary bg-primary-container/10' : 'text-on-surface-variant hover:bg-surface-variant'
            }`}
          >
            <Archive className="h-4 w-4" />
            <span className="font-label-mono text-label-mono">Execution History</span>
          </div>
          
          <div 
            onClick={() => setActiveTab('supabase')}
            className={`flex items-center gap-unit-md px-unit-md py-unit-sm transition-colors duration-200 cursor-pointer ${
              activeTab === 'supabase' ? 'text-primary border-l-2 border-primary bg-primary-container/10' : 'text-on-surface-variant hover:bg-surface-variant'
            }`}
          >
            <Database className="h-4 w-4" />
            <span className="font-label-mono text-label-mono">Supabase Tables</span>
          </div>
          
          <div 
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-unit-md px-unit-md py-unit-sm transition-colors duration-200 cursor-pointer ${
              activeTab === 'api' ? 'text-primary border-l-2 border-primary bg-primary-container/10' : 'text-on-surface-variant hover:bg-surface-variant'
            }`}
          >
            <Settings className="h-4 w-4" />
            <span className="font-label-mono text-label-mono">API Integrations</span>
          </div>
        </nav>
        
        <div className="mt-auto px-unit-md space-y-4">
          <label className="w-full bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-semibold py-2 rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform cursor-pointer">
            <UploadCloud className="h-4 w-4" />
            <span className="font-label-mono text-label-mono uppercase">Upload Dataset</span>
            <input type="file" onChange={handleFileUpload} accept=".csv" className="hidden" />
          </label>
          
          <div className="pt-unit-lg border-t border-outline-variant text-xs text-outline space-y-1">
            <div className="flex items-center gap-2 px-unit-md py-1">
              <div className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(69,223,164,0.6)] animate-pulse"></div>
              <span>{metrics.health}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Top App Bar */}
      <header className="fixed top-0 right-0 left-[250px] h-16 bg-surface border-b border-outline-variant flex justify-between items-center px-margin-desktop z-40">
        <div className="flex items-center gap-unit-lg w-1/2">
          {selectedDataset ? (
            <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-low border border-outline-variant rounded-full text-xs font-semibold text-primary">
              <FileText className="h-3.5 w-3.5" />
              <span>Dataset: {selectedDataset.file_name} ({selectedDataset.row_count} rows)</span>
            </div>
          ) : (
            <div className="text-xs text-outline italic">No dataset active. Upload a CSV to get started.</div>
          )}
        </div>
        
        <div className="flex items-center gap-unit-lg">
          <div className="flex items-center gap-4 border-r border-outline-variant pr-unit-lg">
            <button 
              onClick={toggleTheme}
              className="p-2 text-on-surface-variant hover:text-primary transition-colors"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="text-right">
              <p className="font-label-mono text-label-mono text-on-surface group-hover:text-primary transition-colors">User Profile</p>
              <p className="text-[10px] text-outline font-label-mono uppercase">Admin Access</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center overflow-hidden">
              <img 
                className="w-full h-full object-cover" 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAB3gzee248qWD0iSjTrqGmvmKC5QU0Mr7MJJsmoixA5w-5UcJDTvuWECy1PgmiXxVENq7QFusTyJZMF9sM6j0FUV5T3bfQqvkccuDMpv_JsADFcXyHTok1bZihP6ACfBgtu9gNBJayl0lwhhwfHeWbyECItz3s3LTyWeTUPG2AmnMdB_To7sDZRl_ZJetMPazCPtjixkEY4zREaXo5iYo4MPoygWpLZzJRvZnauVqxXSnQzmCuKGiOhQQEz1wtTPYLhAaVz2LSLLg" 
                alt="Profile" 
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="fixed inset-0 top-16 left-[250px] overflow-y-auto scrollbar-thin p-unit-lg">
        <div className="max-w-container-max mx-auto space-y-gutter pb-unit-xl">
          
          {errorMsg && (
            <div className="p-4 bg-error-container/20 border border-error/30 rounded-lg text-error text-xs flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Tab 1: Dashboard / Workspace */}
          {activeTab === 'dashboard' && (
            <>
              {/* Top Metric Row */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter">
                {/* Card 1 */}
                <div className="bg-surface-container border border-outline-variant p-unit-md rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-outline uppercase tracking-wider">Total Datasets</span>
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-headline-md text-headline-md text-on-surface">{datasets.length}</h2>
                    <p className="text-[10px] text-secondary font-label-mono">CSV sources uploaded</p>
                  </div>
                </div>
                
                {/* Card 2 */}
                <div className="bg-surface-container border border-outline-variant p-unit-md rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-outline uppercase tracking-wider">Mean R² Score</span>
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <h2 className="font-headline-md text-headline-md text-on-surface">
                        {metrics.avgR2 > 0 ? metrics.avgR2.toFixed(3) : 'N/A'}
                      </h2>
                      <span className="font-label-mono text-[10px] text-outline">Target: 0.90</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-500" 
                        style={{ width: `${Math.min(100, Math.max(0, metrics.avgR2 * 100))}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                
                {/* Card 3 */}
                <div className="bg-surface-container border border-outline-variant p-unit-md rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-outline uppercase tracking-wider">Orchestrator</span>
                    <Activity className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-label-mono uppercase ${
                      runStatus === 'running' 
                        ? 'bg-tertiary-container/20 text-tertiary border border-tertiary-container/30' 
                        : runStatus === 'completed'
                        ? 'bg-secondary/10 text-secondary border border-secondary/20'
                        : 'bg-outline-variant/20 text-outline border border-outline-variant/30'
                    }`}>
                      {runStatus === 'running' ? `Running (${activeStep || 'prep'})` : runStatus.toUpperCase()}
                    </div>
                    <p className="text-[10px] text-outline font-label-mono mt-1">
                      {activeRunId ? `Run ID: ${activeRunId.substring(0, 8)}` : 'Standby Mode'}
                    </p>
                  </div>
                </div>
                
                {/* Card 4 */}
                <div className="bg-surface-container border border-outline-variant p-unit-md rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-outline uppercase tracking-wider">Infra Sync</span>
                    <Database className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(69,223,164,0.6)] animate-pulse ${
                      metrics.health.includes('Offline') ? 'bg-error' : 'bg-secondary'
                    }`}></div>
                    <span className="font-label-mono text-label-mono text-on-surface">
                      {metrics.health}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center Split Panel */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter h-[520px]">
                {/* Left Panel: Pipeline Setup / Ingestion */}
                <div className="bg-surface-container border border-outline-variant rounded-lg flex flex-col overflow-hidden">
                  <div className="p-unit-md border-b border-outline-variant flex justify-between items-center">
                    <span className="font-label-mono text-label-mono text-outline uppercase">Pipeline Config</span>
                    {selectedDataset && (
                      <button
                        onClick={startPipelineRun}
                        disabled={runStatus === 'running'}
                        className="px-3 py-1 bg-primary text-background font-semibold font-label-mono text-xs rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1 active:scale-95 transition-all"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        RUN AGENTS
                      </button>
                    )}
                  </div>
                  
                  <div className="p-unit-md flex-1 flex flex-col gap-4 overflow-y-auto scrollbar-thin">
                    
                    {/* If no dataset selected, show upload card */}
                    {!selectedDataset ? (
                      <label className="border-2 border-dashed border-outline-variant rounded-xl p-unit-lg flex flex-col items-center justify-center gap-3 bg-surface-container-low hover:bg-surface-container-high transition-colors cursor-pointer group h-full">
                        <UploadCloud className="h-8 w-8 text-outline group-hover:text-primary" />
                        <p className="font-body-md text-on-surface-variant">Click or Drag to upload CSV dataset</p>
                        <input type="file" onChange={handleFileUpload} accept=".csv" className="hidden" />
                      </label>
                    ) : (
                      <div className="space-y-4 text-xs">
                        {/* Target Variable Dropdown */}
                        <div className="space-y-1">
                          <label className="text-outline uppercase font-label-mono">Target Variable</label>
                          <select 
                            value={targetCol} 
                            onChange={(e) => setTargetCol(e.target.value)}
                            className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface px-3 py-2 rounded focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                          >
                            {Object.keys(selectedDataset.columns_json || {}).map(col => (
                              <option key={col} value={col}>{col} ({selectedDataset.columns_json[col].type})</option>
                            ))}
                          </select>
                        </div>

                        {/* Feature Selection (Numerical columns only) */}
                        <div className="space-y-1">
                          <label className="text-outline uppercase font-label-mono">Predictive Features ({selectedFeatures.length})</label>
                          <div className="max-h-24 overflow-y-auto scrollbar-thin border border-outline-variant rounded p-2 bg-surface-container-lowest space-y-1">
                            {Object.keys(selectedDataset.columns_json || {}).map(col => {
                              const isChecked = selectedFeatures.includes(col);
                              return (
                                <label key={col} className="flex items-center gap-2 py-0.5 cursor-pointer text-on-surface-variant hover:text-on-surface">
                                  <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setSelectedFeatures(prev => prev.filter(f => f !== col));
                                      } else {
                                        setSelectedFeatures(prev => [...prev, col]);
                                      }
                                    }}
                                    className="rounded border-outline-variant bg-surface text-primary focus:ring-0"
                                  />
                                  <span>{col}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Excluded Features (Drop features manually) */}
                        <div className="space-y-1">
                          <label className="text-outline uppercase font-label-mono">Excluded Features ({dropFeatures.length})</label>
                          <div className="max-h-20 overflow-y-auto scrollbar-thin border border-outline-variant rounded p-2 bg-surface-container-lowest space-y-1">
                            {Object.keys(selectedDataset.columns_json || {}).map(col => {
                              const isChecked = dropFeatures.includes(col);
                              return (
                                <label key={col} className="flex items-center gap-2 py-0.5 cursor-pointer text-on-surface-variant hover:text-on-surface">
                                  <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setDropFeatures(prev => prev.filter(f => f !== col));
                                      } else {
                                        setDropFeatures(prev => [...prev, col]);
                                      }
                                    }}
                                    className="rounded border-outline-variant bg-surface text-primary focus:ring-0"
                                  />
                                  <span>{col}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Clusters */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-outline uppercase font-label-mono">K-Means Clusters</label>
                            <input 
                              type="number" 
                              min="2" 
                              max="10"
                              value={kClusters} 
                              onChange={(e) => setKClusters(parseInt(e.target.value) || 3)}
                              className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface px-3 py-1.5 rounded focus:border-primary outline-none"
                            />
                          </div>
                          <div className="space-y-1 flex flex-col justify-end">
                            <button
                              onClick={() => handleSelectDataset(selectedDataset)}
                              className="px-3 py-2 border border-outline-variant text-outline rounded hover:bg-surface-variant font-label-mono text-center"
                            >
                              RESET DEFAULTS
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Flow Diagram (Dynamic based on activeStep) */}
                    <div className="mt-auto pt-4 border-t border-outline-variant flex items-center justify-between px-4">
                      {/* Connection Line */}
                      <div className="relative w-full flex items-center justify-between">
                        <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[2px] bg-outline-variant"></div>
                        
                        {/* Dynamic Active Progress Overlay */}
                        <div 
                          className="absolute left-6 top-1/2 -translate-y-1/2 h-[2px] bg-primary shadow-[0_0_10px_rgba(173,198,255,0.8)] transition-all duration-500"
                          style={{
                            width: activeStep === 'data_prep' ? '20%' :
                                   activeStep === 'ml_modeler' ? '50%' :
                                   activeStep === 'statistical_judge' ? '80%' :
                                   runStatus === 'completed' ? '90%' : '0%'
                          }}
                        ></div>

                        {/* Data Prep Node */}
                        <div className="relative z-20 flex flex-col items-center gap-1.5">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                            stepStatuses.data_prep === 'active' || activeStep === 'data_prep'
                              ? 'bg-surface-container-highest border-primary text-primary node-active'
                              : stepStatuses.data_prep === 'success'
                              ? 'bg-secondary/20 border-secondary text-secondary'
                              : 'bg-surface-container-low border-outline-variant text-outline'
                          }`}>
                            <FileText className="h-4 w-4" />
                          </div>
                          <span className="font-label-mono text-[9px] text-center">Data Prep</span>
                        </div>

                        {/* ML Modeler Node */}
                        <div className="relative z-20 flex flex-col items-center gap-1.5">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                            stepStatuses.ml_modeler === 'active' || activeStep === 'ml_modeler'
                              ? 'bg-surface-container-highest border-primary text-primary node-active'
                              : stepStatuses.ml_modeler === 'success'
                              ? 'bg-secondary/20 border-secondary text-secondary'
                              : 'bg-surface-container-low border-outline-variant text-outline'
                          }`}>
                            <Sliders className="h-4 w-4" />
                          </div>
                          <span className="font-label-mono text-[9px] text-center">ML Modeler</span>
                        </div>

                        {/* Statistical Judge Node */}
                        <div className="relative z-20 flex flex-col items-center gap-1.5">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                            stepStatuses.statistical_judge === 'active' || activeStep === 'statistical_judge'
                              ? 'bg-surface-container-highest border-primary text-primary node-active'
                              : stepStatuses.statistical_judge === 'success'
                              ? 'bg-secondary/20 border-secondary text-secondary'
                              : 'bg-surface-container-low border-outline-variant text-outline'
                          }`}>
                            <Activity className="h-4 w-4" />
                          </div>
                          <span className="font-label-mono text-[9px] text-center">Judge</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Panel: Telemetry Terminal Logs & Plots */}
                <div className="bg-surface-container-lowest border border-outline-variant rounded-lg flex flex-col overflow-hidden">
                  <div className="p-unit-sm bg-surface-container border-b border-outline-variant flex items-center gap-2">
                    <div className="flex gap-1.5 ml-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-error"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-tertiary animate-pulse"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-secondary"></div>
                    </div>
                    <span className="font-label-mono text-[10px] text-outline uppercase ml-4">Terminal Telemetry Logs</span>
                    {selfCorrectionCount > 0 && (
                      <span className="ml-auto bg-error-container/20 text-error border border-error-container/30 px-2 py-0.5 rounded text-[9px] font-label-mono uppercase">
                        Self Correction: {selfCorrectionCount}
                      </span>
                    )}
                  </div>
                  
                  {/* Console scroll container */}
                  <div className="flex-1 p-4 overflow-y-auto scrollbar-thin font-label-mono text-[11px] leading-relaxed space-y-1.5 text-secondary">
                    {terminalLogs.length === 0 ? (
                      <p className="text-outline italic">No logs streamed yet. Initialize a pipeline run to stream live logs.</p>
                    ) : (
                      terminalLogs.map((log, idx) => {
                        let colorClass = "telemetry-line text-on-surface-variant";
                        if (log.includes("[ERROR]")) colorClass = "text-error";
                        else if (log.includes("[SUCCESS]")) colorClass = "text-secondary font-semibold";
                        else if (log.includes("[WARN]")) colorClass = "text-tertiary";
                        else if (log.includes("[SYSTEM]")) colorClass = "text-primary opacity-90";
                        else if (log.includes("pandas") || log.includes("cleaning")) colorClass = "text-secondary opacity-80";
                        
                        return (
                          <p key={idx} className={colorClass}>
                            {log}
                          </p>
                        );
                      })
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                  
                  {/* Plots section inside terminal if generated */}
                  {plots.length > 0 && (
                    <div className="p-3 border-t border-outline-variant bg-surface-container-low flex gap-3 overflow-x-auto scrollbar-thin">
                      {plots.map((plotData, idx) => (
                        <div key={idx} className="shrink-0 bg-white border border-outline-variant p-1.5 rounded max-w-[200px]">
                          <img 
                            src={`data:image/png;base64,${plotData}`} 
                            alt={`Plot ${idx + 1}`}
                            className="max-h-24 object-contain cursor-zoom-in"
                            onClick={() => {
                              const w = window.open("");
                              w.document.write(`<img src="data:image/png;base64,${plotData}" style="max-width:100%; height:auto;" />`);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom: Analytics Results Drawer */}
              <div className="bg-surface-container border border-outline-variant rounded-lg flex flex-col">
                <div className="p-unit-md border-b border-outline-variant flex justify-between items-center">
                  <div className="flex items-center gap-unit-md">
                    <FileText className="h-5 w-5 text-primary" />
                    <h3 className="font-headline-sm text-headline-sm text-on-surface">Analysis Report Insights</h3>
                  </div>
                  {agentOutputs.writer.explanation && (
                    <div className="flex items-center gap-unit-md">
                      <button 
                        onClick={() => window.print()}
                        className="px-3 py-1 border border-outline-variant rounded text-on-surface-variant font-label-mono text-[11px] hover:bg-surface-variant transition-all"
                      >
                        PRINT REPORT
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-unit-lg bg-surface-container-low flex justify-center overflow-x-auto">
                  <article className="w-full max-w-4xl bg-white text-slate-900 rounded shadow-xl p-unit-lg min-h-[400px]">
                    {agentOutputs.writer.explanation ? (
                      <div className="space-y-4 select-text">
                        {renderMarkdown(agentOutputs.writer.explanation)}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
                        <FileCode className="h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">No active report generated.</p>
                        <p className="text-xs max-w-xs text-center opacity-85">Configure features, target, and clusters and run the orchestrator nodes to compile report.</p>
                      </div>
                    )}
                  </article>
                </div>
              </div>
            </>
          )}

          {/* Tab 2: Execution History / Reports Archive */}
          {activeTab === 'archive' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter h-[680px]">
              {/* Left Column: Runs list */}
              <div className="bg-surface-container border border-outline-variant rounded-lg flex flex-col overflow-hidden">
                <div className="p-unit-md border-b border-outline-variant">
                  <span className="font-label-mono text-label-mono text-outline uppercase">Execution Log Archive</span>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-thin p-unit-md space-y-3">
                  {pipelineRuns.length === 0 ? (
                    <p className="text-xs text-outline italic">No past runs found in database.</p>
                  ) : (
                    pipelineRuns.map(run => {
                      const isActive = selectedArchiveRun && selectedArchiveRun.id === run.id;
                      return (
                        <div
                          key={run.id}
                          onClick={() => handleSelectArchiveRun(run.id)}
                          className={`p-3 border rounded-lg cursor-pointer transition-all ${
                            isActive 
                              ? 'border-primary bg-primary-container/10' 
                              : 'border-outline-variant bg-surface-container-low hover:bg-surface-container-high'
                          }`}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-label-mono text-[10px] text-primary font-bold">
                              RUN-{run.id.substring(0, 6).toUpperCase()}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold font-label-mono ${
                              run.run_status === 'completed'
                                ? 'bg-secondary/10 text-secondary'
                                : 'bg-error-container/20 text-error'
                            }`}>
                              {run.run_status.toUpperCase()}
                            </span>
                          </div>
                          
                          <p className="text-xs text-on-surface font-semibold truncate">Target: {run.target_col}</p>
                          <div className="flex justify-between text-[9px] text-outline mt-1 font-label-mono">
                            <span>R²: {run.final_metrics?.r2 ? run.final_metrics.r2.toFixed(3) : 'N/A'}</span>
                            <span>{new Date(run.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              
              {/* Right Columns: Details & Rendered Report */}
              <div className="lg:col-span-2 bg-surface-container border border-outline-variant rounded-lg flex flex-col overflow-hidden">
                <div className="p-unit-md border-b border-outline-variant flex justify-between items-center">
                  <span className="font-label-mono text-label-mono text-outline uppercase">Report View</span>
                  {selectedArchiveRun && (
                    <button
                      onClick={() => setSelectedArchiveRun(null)}
                      className="text-xs text-outline hover:text-on-surface font-label-mono"
                    >
                      CLEAR SELECTION
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-y-auto scrollbar-thin p-unit-lg bg-surface-container-low">
                  {selectedArchiveRun ? (
                    <div className="space-y-6">
                      {/* Meta stats card */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border border-outline-variant rounded-lg bg-surface-container-lowest">
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-outline uppercase font-label-mono">Target Feature</span>
                          <p className="text-xs text-on-surface font-bold truncate">{selectedArchiveRun.target_col}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-outline uppercase font-label-mono">Clusters (k)</span>
                          <p className="text-xs text-on-surface font-bold">{selectedArchiveRun.k_clusters || 'None'}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-outline uppercase font-label-mono">Model Score R²</span>
                          <p className="text-xs text-secondary font-bold font-label-mono">
                            {selectedArchiveRun.final_metrics?.r2 ? selectedArchiveRun.final_metrics.r2.toFixed(4) : 'N/A'}
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-outline uppercase font-label-mono">Self Corrections</span>
                          <p className="text-xs text-tertiary font-bold font-label-mono">
                            {selectedArchiveRun.agent_logs?.filter(l => l.agent_name === 'self_correction').length || 0}
                          </p>
                        </div>
                      </div>

                      {/* Rendered report sheet */}
                      <article className="bg-white text-slate-900 rounded p-unit-lg shadow-xl min-h-[400px] select-text">
                        {selectedArchiveRun.agent_logs?.find(l => l.agent_name === 'writer')?.model_response ? (
                          <div className="space-y-4">
                            {renderMarkdown(selectedArchiveRun.agent_logs.find(l => l.agent_name === 'writer').model_response)}
                          </div>
                        ) : (
                          <p className="text-slate-400 italic text-xs">No compiled report document found in run logs.</p>
                        )}
                      </article>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-40 text-outline gap-2">
                      <Archive className="h-10 w-10 opacity-35" />
                      <p className="text-sm font-semibold">No run selected</p>
                      <p className="text-xs text-center max-w-xs opacity-80">Select a pipeline run execution log from the archive list on the left to view detailed insights.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Supabase Tables Data Visualizer */}
          {activeTab === 'supabase' && (
            <div className="space-y-6">
              {/* Informative Header */}
              <div className="p-5 border border-outline-variant bg-surface-container rounded-lg">
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  Supabase Data Tables
                </h2>
                <p className="text-xs text-outline mt-1.5 leading-relaxed">
                  Below are the synchronized tables managed directly inside your Supabase PostgreSQL instance. You can browse the schemas and total record counts of active datasets, pipeline runs, and multi-agent logs.
                </p>
              </div>

              {/* Grid of Tables */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
                {/* Table 1: datasets */}
                <div className="border border-outline-variant bg-surface-container-low rounded-lg p-unit-md space-y-3">
                  <div className="flex justify-between items-center border-b border-outline-variant pb-2">
                    <span className="font-label-mono text-label-mono text-primary font-bold uppercase">datasets</span>
                    <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded font-label-mono text-[10px] font-bold">
                      {datasets.length} Rows
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">Stores uploaded CSV schema records, target definitions, and unique catalog metadata hashes.</p>
                  
                  <div className="space-y-1.5 pt-2 text-[10px] font-label-mono text-outline">
                    <div className="flex justify-between"><span>id</span><span>UUID (Primary Key)</span></div>
                    <div className="flex justify-between"><span>file_name</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>row_count</span><span>INTEGER</span></div>
                    <div className="flex justify-between"><span>columns_json</span><span>JSONB</span></div>
                    <div className="flex justify-between"><span>created_at</span><span>TIMESTAMP</span></div>
                  </div>
                </div>

                {/* Table 2: pipeline_runs */}
                <div className="border border-outline-variant bg-surface-container-low rounded-lg p-unit-md space-y-3">
                  <div className="flex justify-between items-center border-b border-outline-variant pb-2">
                    <span className="font-label-mono text-label-mono text-primary font-bold uppercase">pipeline_runs</span>
                    <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded font-label-mono text-[10px] font-bold">
                      {pipelineRuns.length} Runs
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">Stores high-level run parameters, final R² scores, execution times, and status trajectory states.</p>
                  
                  <div className="space-y-1.5 pt-2 text-[10px] font-label-mono text-outline">
                    <div className="flex justify-between"><span>id</span><span>UUID (Primary Key)</span></div>
                    <div className="flex justify-between"><span>dataset_id</span><span>UUID (Foreign Key)</span></div>
                    <div className="flex justify-between"><span>target_col</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>run_status</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>final_metrics</span><span>JSONB</span></div>
                  </div>
                </div>

                {/* Table 3: agent_logs */}
                <div className="border border-outline-variant bg-surface-container-low rounded-lg p-unit-md space-y-3">
                  <div className="flex justify-between items-center border-b border-outline-variant pb-2">
                    <span className="font-label-mono text-label-mono text-primary font-bold uppercase">agent_logs</span>
                    <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded font-label-mono text-[10px] font-bold">
                      Active Logs
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">Stores raw prompting inputs, executing outputs, and LLM completions parsed during agent loops.</p>
                  
                  <div className="space-y-1.5 pt-2 text-[10px] font-label-mono text-outline">
                    <div className="flex justify-between"><span>id</span><span>UUID (Primary Key)</span></div>
                    <div className="flex justify-between"><span>run_id</span><span>UUID (Foreign Key)</span></div>
                    <div className="flex justify-between"><span>agent_name</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>model_response</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>created_at</span><span>TIMESTAMP</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: API Integrations & Diagnostics */}
          {activeTab === 'api' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="p-5 border border-outline-variant bg-surface-container rounded-lg">
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
                  <Settings className="h-5 w-5 text-primary" />
                  API Integrations & Agent Health
                </h2>
                <p className="text-xs text-outline mt-1.5 leading-relaxed">
                  Configure connection bindings, sandbox limits, and monitor key access health. The orchestrator routes dynamically based on configuration switches below.
                </p>
              </div>

              {/* Status List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
                {/* Left Card: Gemini Integration */}
                <div className="border border-outline-variant bg-surface-container-low p-unit-lg rounded-lg space-y-4">
                  <h3 className="font-label-mono text-label-mono text-primary font-bold uppercase border-b border-outline-variant pb-1.5">
                    Google Gemini API
                  </h3>
                  
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between items-center">
                      <span>API Status</span>
                      <span className="text-secondary font-bold flex items-center gap-1.5">
                        <CheckCircle className="h-3.5 w-3.5" /> Active (Free Tier limits)
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span>Default Model</span>
                      <span className="font-label-mono text-[11px] bg-surface-container-highest px-2 py-0.5 rounded text-on-surface border border-outline-variant">
                        gemini-2.5-flash
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span>Fallback Engine</span>
                      <span className="text-on-surface-variant">Rule-based script generation</span>
                    </div>

                    <div className="pt-2 text-[10px] text-outline leading-relaxed border-t border-outline-variant">
                      If the Gemini API returns a 429 Rate Limit error, the system will automatically fall back to rule-based code generation and execute the sandbox cleanly.
                    </div>
                  </div>
                </div>

                {/* Right Card: Sandbox executor */}
                <div className="border border-outline-variant bg-surface-container-low p-unit-lg rounded-lg space-y-4">
                  <h3 className="font-label-mono text-label-mono text-primary font-bold uppercase border-b border-outline-variant pb-1.5">
                    Sandbox Code Execution
                  </h3>
                  
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between items-center">
                      <span>Execution Environment</span>
                      <span className="text-secondary font-bold flex items-center gap-1.5">
                        <CheckCircle className="h-3.5 w-3.5" /> Isolated OS Sandbox
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span>Whitelisted Libraries</span>
                      <span className="font-label-mono text-[10px] text-on-surface-variant">
                        pandas, numpy, scikit-learn, matplotlib
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span>Import Guardrails</span>
                      <span className="text-secondary font-semibold">Enabled (AST Parsing)</span>
                    </div>

                    <div className="pt-2 text-[10px] text-outline leading-relaxed border-t border-outline-variant">
                      The sandbox interceptor checks all code blocks for whitelisted modules, prevents writing/reading files outside the workspace environment, and intercepts `plt.show()` to render plots in the telemetry window.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
