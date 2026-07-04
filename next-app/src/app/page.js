"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  CloudUpload,
  CheckCircle2,
  Play,
  Terminal,
  FileText,
  Loader2,
  Server,
  Database,
  ArrowRight,
  RefreshCw,
  Cpu,
  ShieldAlert
} from "lucide-react";

export default function Dashboard() {
  // File upload state
  const [fileName, setFileName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [columns, setColumns] = useState(null);
  const [targetCol, setTargetCol] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const fileInputRef = useRef(null);

  // Run status state
  const [runId, setRunId] = useState("");
  const [activeStep, setActiveStep] = useState("idle"); // idle, data_prep, ml_modeling, statistical_judge, writer, completed, failed
  
  // Pipeline status nodes
  const [stepStates, setStepStates] = useState({
    data_prep: "queued", // queued, running, complete, failed
    ml_modeling: "queued",
    statistical_judge: "queued"
  });

  // Logs & Report State
  const [logs, setLogs] = useState([
    "[00:00:00] SYSTEM: Standby mode. Upload a data matrix source (.csv) to initialize analysis."
  ]);
  const [report, setReport] = useState("");
  const terminalEndRef = useRef(null);
  const wsRef = useRef(null);

  // Sync DB records on startup
  const [dbStatus, setDbStatus] = useState("connecting");

  useEffect(() => {
    // Check backend connection on mount
    fetch("http://localhost:8000/api/health")
      .then((res) => res.json())
      .then((data) => {
        setDbStatus(data.database_type === "Supabase" ? "supabase connected" : "sqlite active");
        addLog("SYSTEM", `Connected to backend. Database mode: ${data.database_type}`);
      })
      .catch((e) => {
        setDbStatus("backend offline");
        addLog("SYSTEM", "Warning: Could not link to backend server on port 8000.");
      });
  }, []);

  // Helper to add timestamped logs
  const addLog = (tag, message) => {
    const timeStr = new Date().toTimeString().split(" ")[0];
    setLogs((prev) => [...prev, `[${timeStr}] ${tag}: ${message}`]);
  };

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Handle local CSV drag and drop / selection
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setIsUploading(true);
    addLog("SYSTEM", `Starting data matrix ingestion for '${file.name}'...`);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("http://localhost:8000/api/upload", {
        method: "POST",
        body: formData
      });
      const data = await response.json();

      if (response.ok) {
        setDatasetId(data.dataset_id);
        setColumns(data.columns);
        
        // Auto-select target column (last column) and features (all other numeric columns)
        const colsList = Object.keys(data.columns);
        const lastCol = colsList[colsList.length - 1];
        setTargetCol(lastCol);
        
        const numerics = colsList.filter(c => c !== lastCol && data.columns[c].type === "numerical");
        setSelectedFeatures(numerics);

        addLog("SYSTEM", `Ingestion complete. Registered ${data.row_count} rows, ${colsList.length} features.`);
      } else {
        addLog("ERROR", data.detail || "Upload failed.");
      }
    } catch (err) {
      addLog("ERROR", `Ingestion failure: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Start Multi-Agent Pipeline
  const startPipeline = async () => {
    if (!datasetId) return;

    addLog("SYSTEM", "Initializing multi-agent pipeline orchestrator...");
    setActiveStep("data_prep");
    setStepStates({
      data_prep: "running",
      ml_modeling: "queued",
      statistical_judge: "queued"
    });
    setReport("");

    try {
      const response = await fetch("http://localhost:8000/api/start-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: datasetId,
          target_col: targetCol,
          features: selectedFeatures,
          k_clusters: 3
        })
      });
      const data = await response.json();

      if (response.ok) {
        setRunId(data.run_id);
        connectWebSocket(data.run_id);
      } else {
        addLog("ERROR", data.detail || "Pipeline start rejected.");
        setActiveStep("failed");
      }
    } catch (err) {
      addLog("ERROR", `Connection error: ${err.message}`);
      setActiveStep("failed");
    }
  };

  // Connect WebSocket to stream logs
  const connectWebSocket = (id) => {
    const ws = new WebSocket(`ws://localhost:8000/ws/pipeline/${id}`);
    wsRef.current = ws;

    ws.onopen = () => {
      addLog("SYSTEM", "Real-time telemetry stream link opened.");
      // Start pipeline run
      ws.send(JSON.stringify({
        target_col: targetCol,
        features: selectedFeatures,
        k_clusters: 3
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "state_update":
          handleStateUpdate(msg);
          break;
        case "terminal_logs":
          if (msg.stdout) addLog("EXEC", msg.stdout.trim());
          if (msg.stderr) addLog("STDERR", msg.stderr.trim());
          break;
        case "agent_message":
          if (msg.agent === "writer") {
            setReport(msg.explanation);
          } else {
            addLog(msg.agent.toUpperCase(), msg.explanation.substring(0, 150) + "...");
          }
          break;
        case "error":
          addLog("ERROR", msg.message);
          setActiveStep("failed");
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      addLog("SYSTEM", "Telemetry stream link closed.");
    };
  };

  const handleStateUpdate = (msg) => {
    const { step, status, message } = msg;
    addLog("STATUS", message);

    if (step === "data_prep") {
      setStepStates(prev => ({
        ...prev,
        data_prep: status === "success" ? "complete" : status === "failed" ? "failed" : "running"
      }));
      if (status === "success") {
        setStepStates(prev => ({ ...prev, ml_modeling: "running" }));
        setActiveStep("ml_modeling");
      }
    } else if (step === "ml_modeler") {
      setStepStates(prev => ({
        ...prev,
        ml_modeling: status === "success" ? "complete" : status === "failed" ? "failed" : "running"
      }));
    } else if (step === "statistical_judge") {
      setStepStates(prev => ({
        ...prev,
        ml_modeling: "complete",
        statistical_judge: status === "active" ? "running" : status === "success" ? "complete" : "queued"
      }));
      if (status === "success") {
        setStepStates(prev => ({ ...prev, statistical_judge: "complete" }));
        setActiveStep("writer");
      }
    } else if (step === "completed") {
      setActiveStep("completed");
      setStepStates({
        data_prep: "complete",
        ml_modeling: "complete",
        statistical_judge: "complete"
      });
    } else if (step === "failed") {
      setActiveStep("failed");
    }
  };

  // Safe markdown renderer helper
  const renderMarkdown = (text) => {
    if (!text) return <p className="text-slate-400 italic text-xs">No analysis report generated yet.</p>;
    
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      if (line.startsWith("# ")) {
        return <h1 key={idx} className="text-base font-bold text-slate-900 border-b border-slate-200 pb-1 mt-4 mb-2 uppercase tracking-tight">{line.replace("# ", "")}</h1>;
      }
      if (line.startsWith("## ")) {
        return <h2 key={idx} className="text-xs font-semibold text-slate-800 mt-3 mb-1.5 uppercase tracking-wider">{line.replace("## ", "")}</h2>;
      }
      if (line.startsWith("### ")) {
        return <h3 key={idx} className="text-xs font-medium text-slate-700 mt-2 mb-1">{line.replace("### ", "")}</h3>;
      }
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        return (
          <li key={idx} className="ml-4 list-disc text-[11px] text-slate-700 mb-1 leading-relaxed">
            {parseInlines(line.trim().substring(2))}
          </li>
        );
      }
      if (line.trim() === "") {
        return <div key={idx} className="h-1"></div>;
      }
      return <p key={idx} className="text-[11px] text-slate-600 mb-1.5 leading-relaxed">{parseInlines(line)}</p>;
    });
  };

  const parseInlines = (text) => {
    const parts = text.split("**");
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <strong key={i} className="font-bold text-slate-900">{part}</strong>;
      }
      const codeParts = part.split("`");
      return codeParts.map((subPart, j) => {
        if (j % 2 === 1) {
          return <code key={j} className="bg-slate-200 text-slate-800 font-mono px-1 py-0.2 rounded text-[9px]">{subPart}</code>;
        }
        return subPart;
      });
    });
  };

  return (
    <div className="flex flex-col h-screen bg-[#07070a] text-slate-100 font-sans overflow-hidden">
      
      {/* 1. FIXED GLOBAL HEADER */}
      <header className="h-14 bg-[#0f172a] border-b border-slate-800 flex items-center justify-between px-6 z-50 shrink-0">
        <div className="flex items-center gap-2.5">
          <Cpu className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-sm tracking-tight text-white uppercase">
            auto-analyst ai
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950 text-slate-400 border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            sandbox active
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950 text-slate-400 border border-slate-800">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            {dbStatus}
          </span>
        </div>
      </header>

      {/* 2. CORE LAYOUT SPLIT-GRID */}
      <div className="flex-1 h-[calc(100vh-3.5rem)] grid grid-cols-10 overflow-hidden">
        
        {/* Left Column: Control & Architecture Tracker Panel (40% width) */}
        <div className="col-span-4 border-r border-slate-800 bg-[#0a0f1d]/60 p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
          
          {/* Segment 1: Ingestion Zone */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
              data ingestion
            </span>
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="h-44 border border-dashed border-slate-700 bg-slate-950 hover:bg-slate-950/60 transition-all rounded-lg flex flex-col items-center justify-center p-6 text-center cursor-pointer group"
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".csv"
                onChange={handleFileChange}
              />
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <span className="text-xs text-slate-400">Ingesting columns data...</span>
                </div>
              ) : fileName ? (
                <div className="flex flex-col items-center gap-1.5">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  <span className="text-xs text-white font-medium break-all">{fileName}</span>
                  <span className="text-[10px] text-slate-500">Dataset registered. Ready to execute.</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2.5">
                  <CloudUpload className="w-8 h-8 text-slate-500 group-hover:text-blue-500 transition-colors" />
                  <p className="text-xs text-slate-300 font-medium">
                    drag and drop data matrix source (.csv) to initiate analytical preprocessing pipelines.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Configuration Selection Pane (Conditional) */}
          {columns && (
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 flex flex-col gap-3 font-mono text-[10px] text-slate-400">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                model configurations
              </span>
              <div>
                <label className="block text-slate-500 mb-1">TARGET COLUMN:</label>
                <select 
                  value={targetCol}
                  onChange={(e) => setTargetCol(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-white"
                >
                  {Object.keys(columns).map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">FEATURES:</label>
                <div className="max-h-24 overflow-y-auto border border-slate-800 rounded p-1.5 space-y-1 bg-slate-900 custom-scrollbar">
                  {Object.keys(columns).map(col => (
                    <label key={col} className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={selectedFeatures.includes(col)}
                        disabled={col === targetCol}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedFeatures(prev => [...prev, col]);
                          } else {
                            setSelectedFeatures(prev => prev.filter(f => f !== col));
                          }
                        }}
                        className="rounded bg-slate-950 border-slate-800 text-blue-500"
                      />
                      <span className="text-slate-300">{col} ({columns[col].type})</span>
                    </label>
                  ))}
                </div>
              </div>

              <button 
                onClick={startPipeline}
                disabled={activeStep !== "idle" && activeStep !== "completed" && activeStep !== "failed"}
                className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold py-2 rounded flex items-center justify-center gap-1.5 font-sans text-xs transition-colors"
              >
                <Play size={12} fill="white" />
                EXECUTE MULTI-AGENT LOOP
              </button>
            </div>
          )}

          {/* Segment 2: Pipeline Status Nodes */}
          <div className="flex-1 flex flex-col gap-2.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
              orchestration nodes
            </span>
            
            {/* Step 1: Data Prep Worker */}
            <div className={`border rounded-lg p-4 flex items-center justify-between transition-colors ${
              stepStates.data_prep === "complete" ? "border-emerald-800/80 bg-emerald-950/5" :
              stepStates.data_prep === "running" ? "border-blue-500 bg-blue-950/5" :
              "border-slate-800 bg-slate-950/20"
            }`}>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-white">data_prep_worker</span>
                <span className="text-[9px] text-slate-400">Normalizes and imputes null values</span>
              </div>
              {stepStates.data_prep === "complete" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : stepStates.data_prep === "running" ? (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              ) : (
                <span className="text-[9px] font-mono text-slate-600 uppercase">queued</span>
              )}
            </div>

            {/* Step 2: ML Modeling Worker */}
            <div className={`border rounded-lg p-4 flex flex-col gap-2.5 transition-colors ${
              stepStates.ml_modeling === "complete" ? "border-emerald-800/80 bg-emerald-950/5" :
              stepStates.ml_modeling === "running" ? "border-blue-500 bg-blue-950/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]" :
              "border-slate-800 bg-slate-950/20"
            }`}>
              <div className="flex items-center justify-between w-full">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-white">ml_modeling_worker</span>
                  <span className="text-[9px] text-slate-400">Fits regression and clusters</span>
                </div>
                {stepStates.ml_modeling === "complete" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : stepStates.ml_modeling === "running" ? (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping"></span>
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  </span>
                ) : (
                  <span className="text-[9px] font-mono text-slate-600 uppercase">queued</span>
                )}
              </div>
              {stepStates.ml_modeling === "running" && (
                <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full w-2/3 rounded-full animate-[pulse_1.5s_infinite]"></div>
                </div>
              )}
            </div>

            {/* Step 3: Statistical Judge */}
            <div className={`border rounded-lg p-4 flex items-center justify-between transition-colors ${
              stepStates.statistical_judge === "complete" ? "border-emerald-800/80 bg-emerald-950/5" :
              stepStates.statistical_judge === "running" ? "border-blue-500 bg-blue-950/5" :
              "border-slate-800 bg-slate-950/20"
            }`}>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-white">statistical_judge</span>
                <span className="text-[9px] text-slate-400">Audits coefficients and VIF boundaries</span>
              </div>
              {stepStates.statistical_judge === "complete" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : stepStates.statistical_judge === "running" ? (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              ) : (
                <span className="text-[9px] font-mono text-slate-600 uppercase">queued</span>
              )}
            </div>

          </div>
        </div>

        {/* Right Column: Execution Terminal & Report Panel (60% width) */}
        <div className="col-span-6 flex flex-col h-full overflow-hidden bg-slate-950">
          
          {/* Top 50%: Logging Console Window */}
          <div className="h-1/2 border-b border-slate-800 bg-black flex flex-col overflow-hidden relative">
            <div className="h-8 bg-zinc-950 px-4 border-b border-zinc-900 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500/80"></span>
                <span className="w-2 h-2 rounded-full bg-amber-500/80"></span>
                <span className="w-2 h-2 rounded-full bg-emerald-500/80"></span>
                <span className="text-[10px] font-mono text-slate-500 ml-2 uppercase tracking-wide">
                  execution telemetry console
                </span>
              </div>
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
            </div>

            {/* Monospace telemetry logs */}
            <div className="flex-1 p-5 font-mono text-[10px] text-zinc-300 leading-relaxed overflow-y-auto custom-scrollbar">
              {logs.map((log, index) => {
                let color = "text-slate-300";
                if (log.includes("SYSTEM:")) color = "text-blue-400";
                else if (log.includes("STATUS:")) color = "text-indigo-400";
                else if (log.includes("ERROR:")) color = "text-rose-500 font-bold";
                else if (log.includes("WARNING:")) color = "text-amber-500 font-bold";
                else if (log.includes("EXEC:")) color = "text-slate-400";
                else if (log.includes("STDERR:")) color = "text-red-400";

                return (
                  <div key={index} className={`${color} mb-1 break-all`}>
                    {log}
                  </div>
                );
              })}
              {/* Blinking cursor */}
              <div className="flex items-center gap-1 mt-1.5 text-blue-500">
                <span>$</span>
                <span className="w-1.5 h-3 bg-blue-500 animate-pulse"></span>
              </div>
              <div ref={terminalEndRef} />
            </div>
          </div>

          {/* Bottom 50%: Finished Report Container */}
          <div className="h-1/2 p-6 flex flex-col overflow-hidden bg-slate-900/10">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 shrink-0 select-none">
              analytical intelligence report
            </span>
            
            {/* High-contrast document card */}
            <div className="flex-1 bg-white border border-slate-200 rounded-lg p-6 overflow-y-auto custom-scrollbar shadow-inner text-slate-900">
              <div className="max-w-none">
                {renderMarkdown(report)}
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
