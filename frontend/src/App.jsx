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
    if (!dataset) {
      setTargetCol('');
      setSelectedFeatures([]);
      setDropFeatures([]);
      return;
    }
    
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

  const handleNewAnalysis = () => {
    setSelectedDataset(null);
    setTargetCol('');
    setSelectedFeatures([]);
    setDropFeatures([]);
    setTerminalLogs([]);
    setPlots([]);
    setRunStatus('idle');
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
    setActiveTab('dashboard');
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
    <div className="flex h-screen w-screen overflow-hidden bg-[#10131a] text-[#e1e2ec] font-sans select-none">
      
      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 h-full w-[250px] bg-[#1d2027] border-r border-[#424754] flex flex-col py-6 z-50">
        <div className="px-4 mb-12">
          <h1 className="text-lg font-bold text-[#e1e2ec] flex items-center gap-2">
            <span className="material-symbols-outlined text-[#adc6ff] text-[22px]">analytics</span>
            Auto-Analyst AI
          </h1>
          <p className="font-label-mono text-[10px] text-[#8c909f] uppercase tracking-widest mt-1">Enterprise Analytics</p>
        </div>
        
        <nav className="flex-1 flex flex-col gap-1">
          <div 
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-4 px-4 py-2 transition-colors duration-200 cursor-pointer ${
              activeTab === 'dashboard' ? 'text-[#adc6ff] border-l-2 border-[#adc6ff] bg-[#4d8eff]/10' : 'text-[#c2c6d6] hover:bg-[#32353c]'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">dashboard</span>
            <span className="font-label-mono text-xs font-medium">Workspace</span>
          </div>
          
          <div 
            onClick={() => setActiveTab('archive')}
            className={`flex items-center gap-4 px-4 py-2 transition-colors duration-200 cursor-pointer ${
              activeTab === 'archive' ? 'text-[#adc6ff] border-l-2 border-[#adc6ff] bg-[#4d8eff]/10' : 'text-[#c2c6d6] hover:bg-[#32353c]'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">history</span>
            <span className="font-label-mono text-xs font-medium">Execution History</span>
          </div>
          
          <div 
            onClick={() => setActiveTab('supabase')}
            className={`flex items-center gap-4 px-4 py-2 transition-colors duration-200 cursor-pointer ${
              activeTab === 'supabase' ? 'text-[#adc6ff] border-l-2 border-[#adc6ff] bg-[#4d8eff]/10' : 'text-[#c2c6d6] hover:bg-[#32353c]'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">database</span>
            <span className="font-label-mono text-xs font-medium">Supabase Tables</span>
          </div>
          
          <div 
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-4 px-4 py-2 transition-colors duration-200 cursor-pointer ${
              activeTab === 'api' ? 'text-[#adc6ff] border-l-2 border-[#adc6ff] bg-[#4d8eff]/10' : 'text-[#c2c6d6] hover:bg-[#32353c]'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">settings_input_component</span>
            <span className="font-label-mono text-xs font-medium">API Integrations</span>
          </div>
        </nav>
        
        <div className="mt-auto px-4 space-y-4">
          <button 
            onClick={handleNewAnalysis}
            className="w-full bg-[#4d8eff] hover:bg-[#4d8eff]/90 text-[#001a42] font-semibold py-2 rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span className="font-label-mono text-xs uppercase">New Analysis</span>
          </button>
          
          <div className="pt-4 border-t border-[#424754]">
            <div className="flex items-center gap-4 px-4 py-2 text-[#c2c6d6] hover:bg-[#32353c] transition-colors duration-200 cursor-pointer">
              <span className="material-symbols-outlined text-[20px]">help</span>
              <span className="font-label-mono text-xs font-medium">Documentation</span>
            </div>
            <div className="flex items-center gap-4 px-4 py-2 text-[#c2c6d6] hover:bg-[#32353c] transition-colors duration-200 cursor-pointer">
              <span className="material-symbols-outlined text-[20px]">support_agent</span>
              <span className="font-label-mono text-xs font-medium">Support</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Top App Bar */}
      <header className="fixed top-0 right-0 left-[250px] h-16 bg-[#10131a] border-b border-[#424754] flex justify-between items-center px-8 z-40">
        <div className="flex items-center gap-6 w-1/2">
          {selectedDataset ? (
            <div className="flex items-center gap-2 px-3 py-1 bg-[#191b23] border border-[#424754] rounded-full text-xs font-semibold text-[#adc6ff]">
              <span className="material-symbols-outlined text-[16px]">description</span>
              <span>Dataset: {selectedDataset.file_name} ({selectedDataset.row_count} rows)</span>
            </div>
          ) : (
            <div className="relative w-full max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8c909f] text-[20px]">search</span>
              <input 
                className="w-full bg-[#0b0e15] border border-[#424754] rounded-full py-1.5 pl-10 pr-4 text-xs focus:border-[#4d8eff] focus:ring-1 focus:ring-[#4d8eff] transition-all outline-none" 
                placeholder="Search models, agents, or tables..." 
                type="text"
                readOnly
              />
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 border-r border-[#424754] pr-6 text-[#c2c6d6]">
            <span className="material-symbols-outlined hover:text-[#adc6ff] cursor-pointer transition-colors">notifications</span>
            <button 
              onClick={toggleTheme}
              className="hover:text-[#adc6ff] transition-colors flex items-center"
              title="Toggle Theme"
            >
              {theme === 'dark' ? (
                <span className="material-symbols-outlined">light_mode</span>
              ) : (
                <span className="material-symbols-outlined">dark_mode</span>
              )}
            </button>
          </div>
          
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="text-right">
              <p className="font-label-mono text-xs text-[#e1e2ec] group-hover:text-[#adc6ff] transition-colors">User Profile</p>
              <p className="text-[10px] text-[#8c909f] font-label-mono uppercase">Admin Access</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-[#272a31] border border-[#424754] flex items-center justify-center overflow-hidden">
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
      <main className="fixed inset-0 top-16 left-[250px] overflow-y-auto scrollbar-thin p-6 bg-[#10131a]">
        <div className="max-w-[1440px] mx-auto space-y-6 pb-12">
          
          {errorMsg && (
            <div className="p-4 bg-[#93000a]/20 border border-[#ffb4ab]/30 rounded-lg text-[#ffb4ab] text-xs flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Tab 1: Dashboard / Workspace */}
          {activeTab === 'dashboard' && (
            <>
              {/* Top Metric Row */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Card 1 */}
                <div className="bg-[#1d2027] border border-[#424754] p-4 rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-[#8c909f] uppercase tracking-wider">Total Datasets</span>
                    <span className="material-symbols-outlined text-[#adc6ff] text-[18px]">analytics</span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-[#e1e2ec]">{datasets.length}</h2>
                    <p className="text-[10px] text-[#45dfa4] font-label-mono">CSV sources uploaded</p>
                  </div>
                </div>
                
                {/* Card 2 */}
                <div className="bg-[#1d2027] border border-[#424754] p-4 rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-[#8c909f] uppercase tracking-wider">Mean R² Score</span>
                    <span className="material-symbols-outlined text-[#adc6ff] text-[18px]">equalizer</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <h2 className="text-2xl font-bold text-[#e1e2ec]">
                        {metrics.avgR2 > 0 ? metrics.avgR2.toFixed(3) : 'N/A'}
                      </h2>
                      <span className="font-label-mono text-[10px] text-[#8c909f]">Target: 0.90</span>
                    </div>
                    <div className="w-full h-1.5 bg-[#32353c] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#adc6ff] transition-all duration-500" 
                        style={{ width: `${Math.min(100, Math.max(0, metrics.avgR2 * 100))}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                
                {/* Card 3 */}
                <div className="bg-[#1d2027] border border-[#424754] p-4 rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-[#8c909f] uppercase tracking-wider">Orchestrator</span>
                    <span className="material-symbols-outlined text-[#adc6ff] text-[18px]">psychology</span>
                  </div>
                  <div>
                    <div className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-label-mono uppercase ${
                      runStatus === 'running' 
                        ? 'bg-[#df7412]/20 text-[#ffb786] border border-[#df7412]/30' 
                        : runStatus === 'completed'
                        ? 'bg-[#00bd85]/10 text-[#45dfa4] border border-[#00bd85]/20'
                        : 'bg-[#424754]/20 text-[#8c909f] border border-[#424754]/30'
                    }`}>
                      {runStatus === 'running' ? `Evaluating Steps` : runStatus.toUpperCase()}
                    </div>
                    <p className="text-[10px] text-[#8c909f] font-label-mono mt-1">
                      {activeRunId ? `Run ID: RUN-${activeRunId.substring(0, 5).toUpperCase()}` : 'Standby Mode'}
                    </p>
                  </div>
                </div>
                
                {/* Card 4 */}
                <div className="bg-[#1d2027] border border-[#424754] p-4 rounded-lg flex flex-col justify-between h-32">
                  <div className="flex justify-between items-start">
                    <span className="font-label-mono text-[11px] text-[#8c909f] uppercase tracking-wider">Infra Sync</span>
                    <span className="material-symbols-outlined text-[#adc6ff] text-[18px]">cloud_sync</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(69,223,164,0.6)] animate-pulse ${
                      metrics.health.includes('Offline') ? 'bg-[#ffb4ab]' : 'bg-[#45dfa4]'
                    }`}></div>
                    <span className="font-label-mono text-xs text-[#e1e2ec]">
                      {metrics.health}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center Split Panel */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[520px]">
                {/* Left Panel: Pipeline Setup / Ingestion */}
                <div className="bg-[#1d2027] border border-[#424754] rounded-lg flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-[#424754] flex justify-between items-center bg-[#1d2027]">
                    <span className="font-label-mono text-xs text-[#8c909f] uppercase">Pipeline Config</span>
                    {selectedDataset && (
                      <button
                        onClick={startPipelineRun}
                        disabled={runStatus === 'running'}
                        className="px-3 py-1 bg-[#adc6ff] text-[#002e6a] font-semibold font-label-mono text-xs rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                        RUN AGENTS
                      </button>
                    )}
                  </div>
                  
                  <div className="p-4 flex-1 flex flex-col gap-4 overflow-y-auto scrollbar-thin">
                    
                    {/* If no dataset selected, show upload card */}
                    {!selectedDataset ? (
                      <label className="border-2 border-dashed border-[#424754] rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-[#191b23] hover:bg-[#272a31] transition-colors cursor-pointer group h-full">
                        <span className="material-symbols-outlined text-[32px] text-[#8c909f] group-hover:text-[#adc6ff] transition-colors">upload_file</span>
                        <p className="text-xs text-[#c2c6d6]">Upload source data matrix <span className="text-[#adc6ff] font-label-mono">(.csv)</span></p>
                        <input type="file" onChange={handleFileUpload} accept=".csv" className="hidden" />
                      </label>
                    ) : (
                      <div className="space-y-4 text-xs">
                        {/* Target Variable Dropdown */}
                        <div className="space-y-1">
                          <label className="text-[#8c909f] uppercase font-label-mono">Target Variable</label>
                          <select 
                            value={targetCol} 
                            onChange={(e) => setTargetCol(e.target.value)}
                            className="w-full bg-[#0b0e15] border border-[#424754] text-[#e1e2ec] px-3 py-2 rounded focus:border-[#adc6ff] focus:ring-1 focus:ring-[#adc6ff] outline-none"
                          >
                            {Object.keys(selectedDataset.columns_json || {}).map(col => (
                              <option key={col} value={col}>{col} ({selectedDataset.columns_json[col].type})</option>
                            ))}
                          </select>
                        </div>

                        {/* Feature Selection */}
                        <div className="space-y-1">
                          <label className="text-[#8c909f] uppercase font-label-mono">Predictive Features ({selectedFeatures.length})</label>
                          <div className="max-h-24 overflow-y-auto scrollbar-thin border border-[#424754] rounded p-2 bg-[#0b0e15] space-y-1">
                            {Object.keys(selectedDataset.columns_json || {}).map(col => {
                              const isChecked = selectedFeatures.includes(col);
                              return (
                                <label key={col} className="flex items-center gap-2 py-0.5 cursor-pointer text-[#c2c6d6] hover:text-[#e1e2ec]">
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
                                    className="rounded border-[#424754] bg-[#10131a] text-[#adc6ff] focus:ring-0"
                                  />
                                  <span>{col}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Excluded Features (Drop features manually) */}
                        <div className="space-y-1">
                          <label className="text-[#8c909f] uppercase font-label-mono">Excluded Features ({dropFeatures.length})</label>
                          <div className="max-h-20 overflow-y-auto scrollbar-thin border border-[#424754] rounded p-2 bg-[#0b0e15] space-y-1">
                            {Object.keys(selectedDataset.columns_json || {}).map(col => {
                              const isChecked = dropFeatures.includes(col);
                              return (
                                <label key={col} className="flex items-center gap-2 py-0.5 cursor-pointer text-[#c2c6d6] hover:text-[#e1e2ec]">
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
                                    className="rounded border-[#424754] bg-[#10131a] text-[#adc6ff] focus:ring-0"
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
                            <label className="text-[#8c909f] uppercase font-label-mono">K-Means Clusters</label>
                            <input 
                              type="number" 
                              min="2" 
                              max="10"
                              value={kClusters} 
                              onChange={(e) => setKClusters(parseInt(e.target.value) || 3)}
                              className="w-full bg-[#0b0e15] border border-[#424754] text-[#e1e2ec] px-3 py-1.5 rounded focus:border-[#adc6ff] outline-none"
                            />
                          </div>
                          <div className="space-y-1 flex flex-col justify-end">
                            <button
                              onClick={() => handleSelectDataset(selectedDataset)}
                              className="px-3 py-2 border border-[#424754] text-[#8c909f] rounded hover:bg-[#32353c] hover:text-[#e1e2ec] font-label-mono text-center cursor-pointer transition-colors"
                            >
                              RESET DEFAULTS
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Flow Diagram (Dynamic based on activeStep) */}
                    <div className="mt-auto pt-4 border-t border-[#424754] flex items-center justify-between px-4">
                      <div className="relative w-full flex items-center justify-between">
                        <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[2px] bg-[#424754]"></div>
                        
                        {/* Dynamic Active Progress Overlay */}
                        <div 
                          className="absolute left-6 top-1/2 -translate-y-1/2 h-[2px] bg-[#adc6ff] shadow-[0_0_10px_rgba(173,198,255,0.8)] transition-all duration-500"
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
                              ? 'bg-[#32353c] border-[#adc6ff] text-[#adc6ff] node-active'
                              : stepStatuses.data_prep === 'success'
                              ? 'bg-[#00bd85]/20 border-[#00bd85] text-[#45dfa4]'
                              : 'bg-[#191b23] border-[#424754] text-[#8c909f]'
                          }`}>
                            <span className="material-symbols-outlined text-[18px]">dataset</span>
                          </div>
                          <span className="font-label-mono text-[9px] text-center">Data Prep</span>
                        </div>

                        {/* ML Modeler Node */}
                        <div className="relative z-20 flex flex-col items-center gap-1.5">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                            stepStatuses.ml_modeler === 'active' || activeStep === 'ml_modeler'
                              ? 'bg-[#32353c] border-[#adc6ff] text-[#adc6ff] node-active'
                              : stepStatuses.ml_modeler === 'success'
                              ? 'bg-[#00bd85]/20 border-[#00bd85] text-[#45dfa4]'
                              : 'bg-[#191b23] border-[#424754] text-[#8c909f]'
                          }`}>
                            <span className="material-symbols-outlined text-[18px]">model_training</span>
                          </div>
                          <span className="font-label-mono text-[9px] text-center">ML Modeler</span>
                        </div>

                        {/* Statistical Judge Node */}
                        <div className="relative z-20 flex flex-col items-center gap-1.5">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                            stepStatuses.statistical_judge === 'active' || activeStep === 'statistical_judge'
                              ? 'bg-[#32353c] border-[#adc6ff] text-[#adc6ff] node-active'
                              : stepStatuses.statistical_judge === 'success'
                              ? 'bg-[#00bd85]/20 border-[#00bd85] text-[#45dfa4]'
                              : 'bg-[#191b23] border-[#424754] text-[#8c909f]'
                          }`}>
                            <span className="material-symbols-outlined text-[18px]">gavel</span>
                          </div>
                          <span className="font-label-mono text-[9px] text-center">Judge</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Panel: Telemetry Terminal Logs & Plots */}
                <div className="bg-[#10131a] border border-[#424754] rounded-lg flex flex-col overflow-hidden">
                  <div className="p-2 bg-[#1d2027] border-b border-[#424754] flex items-center gap-2">
                    <div className="flex gap-1.5 ml-1 select-none">
                      <div className="w-2 h-2 rounded-full bg-[#ffb4ab]"></div>
                      <div className="w-2 h-2 rounded-full bg-[#ffb786]"></div>
                      <div className="w-2 h-2 rounded-full bg-[#45dfa4]"></div>
                    </div>
                    <span className="font-label-mono text-[10px] text-[#8c909f] uppercase ml-4">Terminal Telemetry Console</span>
                    {selfCorrectionCount > 0 && (
                      <span className="ml-auto bg-[#93000a]/20 text-[#ffb4ab] border border-[#93000a]/30 px-2 py-0.5 rounded text-[9px] font-label-mono uppercase">
                        Self Correction: {selfCorrectionCount}
                      </span>
                    )}
                  </div>
                  
                  {/* Console scroll container */}
                  <div className="flex-1 p-4 overflow-y-auto scrollbar-thin font-label-mono text-[11px] leading-relaxed space-y-1.5 text-[#45dfa4]">
                    {terminalLogs.length === 0 ? (
                      <p className="text-[#8c909f] italic">No logs streamed yet. Initialize a pipeline run to stream live logs.</p>
                    ) : (
                      terminalLogs.map((log, idx) => {
                        let colorClass = "telemetry-line text-[#e1e2ec]";
                        if (log.includes("[ERROR]") || log.includes("Error")) colorClass = "text-[#ffb4ab] font-bold";
                        else if (log.includes("[SUCCESS]") || log.includes("SUCCESS")) colorClass = "text-[#45dfa4] font-semibold";
                        else if (log.includes("[WARN]") || log.includes("WARN")) colorClass = "text-[#ffb786]";
                        else if (log.includes("[SYSTEM]") || log.includes("SYSTEM")) colorClass = "text-[#adc6ff] opacity-90";
                        else if (log.includes("pandas") || log.includes("cleaning")) colorClass = "text-[#45dfa4] opacity-80";
                        
                        return (
                          <p key={idx} className={colorClass}>
                            {log}
                          </p>
                        );
                      })
                    )}
                    {/* Blinking cursor */}
                    <div className="flex items-center gap-1 text-[#adc6ff] mt-1">
                      <span>$</span>
                      <span className="w-1.5 h-3 bg-[#adc6ff] animate-pulse"></span>
                    </div>
                    <div ref={terminalEndRef} />
                  </div>
                  
                  {/* Plots section inside terminal if generated */}
                  {plots.length > 0 && (
                    <div className="p-3 border-t border-[#424754] bg-[#191b23] flex gap-3 overflow-x-auto scrollbar-thin">
                      {plots.map((plotData, idx) => (
                        <div key={idx} className="shrink-0 bg-white border border-[#424754] p-1.5 rounded max-w-[200px]">
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
              <div className="bg-[#1d2027] border border-[#424754] rounded-lg flex flex-col">
                <div className="p-4 border-b border-[#424754] flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#adc6ff]">description</span>
                    <h3 className="text-sm font-semibold text-[#e1e2ec]">Analysis Report Insights</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => window.print()}
                      className="px-3 py-1 border border-[#424754] rounded text-[#c2c6d6] font-label-mono text-[11px] hover:bg-[#32353c] transition-all cursor-pointer"
                    >
                      EXPORT PDF
                    </button>
                    <button 
                      className="px-3 py-1 bg-[#adc6ff]/10 border border-[#adc6ff] text-[#adc6ff] rounded font-label-mono text-[11px] hover:bg-[#adc6ff]/20 transition-all cursor-pointer"
                    >
                      PUBLISH TO DASHBOARD
                    </button>
                  </div>
                </div>
                <div className="p-8 bg-[#191b23] flex justify-center overflow-x-auto">
                  <article className="w-full max-w-4xl bg-white text-slate-900 rounded-sm shadow-xl p-8 min-h-[500px]">
                    {agentOutputs.writer.explanation ? (
                      <div className="space-y-4 select-text">
                        {renderMarkdown(agentOutputs.writer.explanation)}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
                        <span className="material-symbols-outlined text-[40px] opacity-40 text-slate-500">article</span>
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[680px]">
              {/* Left Column: Runs list */}
              <div className="bg-[#1d2027] border border-[#424754] rounded-lg flex flex-col overflow-hidden">
                <div className="p-4 border-b border-[#424754]">
                  <span className="font-label-mono text-xs text-[#8c909f] uppercase">Execution Log Archive</span>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                  {pipelineRuns.length === 0 ? (
                    <p className="text-xs text-[#8c909f] italic">No past runs found in database.</p>
                  ) : (
                    pipelineRuns.map(run => {
                      const isActive = selectedArchiveRun && selectedArchiveRun.id === run.id;
                      return (
                        <div
                          key={run.id}
                          onClick={() => handleSelectArchiveRun(run.id)}
                          className={`p-3 border rounded-lg cursor-pointer transition-all ${
                            isActive 
                              ? 'border-[#adc6ff] bg-[#adc6ff]/10' 
                              : 'border-[#424754] bg-[#191b23] hover:bg-[#272a31]'
                          }`}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-label-mono text-[10px] text-[#adc6ff] font-bold">
                              RUN-{run.id.substring(0, 6).toUpperCase()}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold font-label-mono ${
                              run.run_status === 'completed'
                                ? 'bg-[#00bd85]/10 text-[#45dfa4]'
                                : 'bg-[#93000a]/20 text-[#ffb4ab]'
                            }`}>
                              {run.run_status.toUpperCase()}
                            </span>
                          </div>
                          
                          <p className="text-xs text-[#e1e2ec] font-semibold truncate">Target: {run.target_col}</p>
                          <div className="flex justify-between text-[9px] text-[#8c909f] mt-1 font-label-mono">
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
              <div className="lg:col-span-2 bg-[#1d2027] border border-[#424754] rounded-lg flex flex-col overflow-hidden">
                <div className="p-4 border-b border-[#424754] flex justify-between items-center">
                  <span className="font-label-mono text-xs text-[#8c909f] uppercase">Report View</span>
                  {selectedArchiveRun && (
                    <button
                      onClick={() => setSelectedArchiveRun(null)}
                      className="text-xs text-[#8c909f] hover:text-[#e1e2ec] font-label-mono cursor-pointer"
                    >
                      CLEAR SELECTION
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-y-auto scrollbar-thin p-6 bg-[#191b23]">
                  {selectedArchiveRun ? (
                    <div className="space-y-6">
                      {/* Meta stats card */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border border-[#424754] rounded-lg bg-[#0b0e15]">
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-[#8c909f] uppercase font-label-mono">Target Feature</span>
                          <p className="text-xs text-[#e1e2ec] font-bold truncate">{selectedArchiveRun.target_col}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-[#8c909f] uppercase font-label-mono">Clusters (k)</span>
                          <p className="text-xs text-[#e1e2ec] font-bold">{selectedArchiveRun.k_clusters || 'None'}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-[#8c909f] uppercase font-label-mono">Model Score R²</span>
                          <p className="text-xs text-[#45dfa4] font-bold font-label-mono">
                            {selectedArchiveRun.final_metrics?.r2 ? selectedArchiveRun.final_metrics.r2.toFixed(4) : 'N/A'}
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-[#8c909f] uppercase font-label-mono">Self Corrections</span>
                          <p className="text-xs text-[#ffb786] font-bold font-label-mono">
                            {selectedArchiveRun.agent_logs?.filter(l => l.agent_name === 'self_correction').length || 0}
                          </p>
                        </div>
                      </div>

                      {/* Rendered report sheet */}
                      <article className="bg-white text-slate-900 rounded p-8 shadow-xl min-h-[400px] select-text">
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
                    <div className="flex flex-col items-center justify-center py-44 text-[#8c909f] gap-2">
                      <span className="material-symbols-outlined text-[40px] opacity-35">archive</span>
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
              <div className="p-5 border border-[#424754] bg-[#1d2027] rounded-lg">
                <h2 className="text-lg text-[#e1e2ec] font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#adc6ff]">database</span>
                  Supabase Data Tables
                </h2>
                <p className="text-xs text-[#8c909f] mt-1.5 leading-relaxed">
                  Below are the synchronized tables managed directly inside your Supabase PostgreSQL instance. You can browse the schemas and total record counts of active datasets, pipeline runs, and multi-agent logs.
                </p>
              </div>

              {/* Grid of Tables */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Table 1: datasets */}
                <div className="border border-[#424754] bg-[#191b23] rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center border-b border-[#424754] pb-2">
                    <span className="font-label-mono text-xs text-[#adc6ff] font-bold uppercase">datasets</span>
                    <span className="px-2 py-0.5 bg-[#4d8eff]/10 text-[#adc6ff] border border-[#4d8eff]/20 rounded font-label-mono text-[10px] font-bold">
                      {datasets.length} Rows
                    </span>
                  </div>
                  <p className="text-xs text-[#c2c6d6]">Stores uploaded CSV schema records, target definitions, and unique catalog metadata hashes.</p>
                  
                  <div className="space-y-1.5 pt-2 text-[10px] font-label-mono text-[#8c909f]">
                    <div className="flex justify-between"><span>id</span><span>UUID (Primary Key)</span></div>
                    <div className="flex justify-between"><span>file_name</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>row_count</span><span>INTEGER</span></div>
                    <div className="flex justify-between"><span>columns_json</span><span>JSONB</span></div>
                    <div className="flex justify-between"><span>created_at</span><span>TIMESTAMP</span></div>
                  </div>
                </div>

                {/* Table 2: pipeline_runs */}
                <div className="border border-[#424754] bg-[#191b23] rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center border-b border-[#424754] pb-2">
                    <span className="font-label-mono text-xs text-[#adc6ff] font-bold uppercase">pipeline_runs</span>
                    <span className="px-2 py-0.5 bg-[#4d8eff]/10 text-[#adc6ff] border border-[#4d8eff]/20 rounded font-label-mono text-[10px] font-bold">
                      {pipelineRuns.length} Runs
                    </span>
                  </div>
                  <p className="text-xs text-[#c2c6d6]">Stores high-level run parameters, final R² scores, execution times, and status trajectory states.</p>
                  
                  <div className="space-y-1.5 pt-2 text-[10px] font-label-mono text-[#8c909f]">
                    <div className="flex justify-between"><span>id</span><span>UUID (Primary Key)</span></div>
                    <div className="flex justify-between"><span>dataset_id</span><span>UUID (Foreign Key)</span></div>
                    <div className="flex justify-between"><span>target_col</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>run_status</span><span>TEXT</span></div>
                    <div className="flex justify-between"><span>final_metrics</span><span>JSONB</span></div>
                  </div>
                </div>

                {/* Table 3: agent_logs */}
                <div className="border border-[#424754] bg-[#191b23] rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center border-b border-[#424754] pb-2">
                    <span className="font-label-mono text-xs text-[#adc6ff] font-bold uppercase">agent_logs</span>
                    <span className="px-2 py-0.5 bg-[#4d8eff]/10 text-[#adc6ff] border border-[#4d8eff]/20 rounded font-label-mono text-[10px] font-bold">
                      Active Logs
                    </span>
                  </div>
                  <p className="text-xs text-[#c2c6d6]">Stores raw prompting inputs, executing outputs, and LLM completions parsed during agent loops.</p>
                  
                  <div className="space-y-1.5 pt-2 text-[10px] font-label-mono text-[#8c909f]">
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
              <div className="p-5 border border-[#424754] bg-[#1d2027] rounded-lg">
                <h2 className="text-lg text-[#e1e2ec] font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#adc6ff]">settings</span>
                  API Integrations & Agent Health
                </h2>
                <p className="text-xs text-[#8c909f] mt-1.5 leading-relaxed">
                  Configure connection bindings, sandbox limits, and monitor key access health. The orchestrator routes dynamically based on configuration switches below.
                </p>
              </div>

              {/* Status List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Card: Gemini Integration */}
                <div className="border border-[#424754] bg-[#191b23] p-6 rounded-lg space-y-4">
                  <h3 className="font-label-mono text-xs text-[#adc6ff] font-bold uppercase border-b border-[#424754] pb-1.5">
                    Google Gemini API
                  </h3>
                  
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between items-center">
                      <span>API Status</span>
                      <span className="text-[#45dfa4] font-bold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span> Active (Free Tier limits)
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span>Default Model</span>
                      <span className="font-label-mono text-[11px] bg-[#32353c] px-2 py-0.5 rounded text-[#e1e2ec] border border-[#424754]">
                        gemini-2.5-flash
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span>Fallback Engine</span>
                      <span className="text-[#c2c6d6]">Rule-based script generation</span>
                    </div>

                    <div className="pt-2 text-[10px] text-[#8c909f] leading-relaxed border-t border-[#424754]">
                      If the Gemini API returns a 429 Rate Limit error, the system will automatically fall back to rule-based code generation and execute the sandbox cleanly.
                    </div>
                  </div>
                </div>

                {/* Right Card: Sandbox executor */}
                <div className="border border-[#424754] bg-[#191b23] p-6 rounded-lg space-y-4">
                  <h3 className="font-label-mono text-xs text-[#adc6ff] font-bold uppercase border-b border-[#424754] pb-1.5">
                    Sandbox Code Execution
                  </h3>
                  
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between items-center">
                      <span>Execution Environment</span>
                      <span className="text-[#45dfa4] font-bold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span> Isolated OS Sandbox
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span>Whitelisted Libraries</span>
                      <span className="font-label-mono text-[10px] text-[#c2c6d6]">
                        pandas, numpy, scikit-learn, matplotlib
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span>Import Guardrails</span>
                      <span className="text-[#45dfa4] font-semibold">Enabled (AST Parsing)</span>
                    </div>

                    <div className="pt-2 text-[10px] text-[#8c909f] leading-relaxed border-t border-[#424754]">
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
