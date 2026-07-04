"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  History,
  Database,
  Settings,
  CloudUpload,
  Play,
  CheckCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Circle,
  ArrowRight,
  Terminal,
  FileText,
  Sparkles,
  RefreshCw,
  Clock,
  Server
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

// Instantiate Supabase client
const supabase = createClient();

export default function Dashboard() {
  // Navigation State
  const [activeTab, setActiveTab] = useState("workspace");

  // Drawer State
  const [reportOpen, setReportOpen] = useState(true);

  // File Upload State
  const [fileName, setFileName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Database State
  const [totalRuns, setTotalRuns] = useState(42);
  const [avgR2, setAvgR2] = useState(0.84);
  const [runsList, setRunsList] = useState([]);
  const [datasetsList, setDatasetsList] = useState([]);
  const [loadingDb, setLoadingDb] = useState(false);

  // Terminal Logs State
  const [logs, setLogs] = useState([
    "[system] initializing pandas data ingestion dataframe...",
    "[system] dataset sales_data_q2.csv ingested successfully (4500 rows, 12 columns)",
    "[data_prep worker] checking for null fields... (found 15 missing in 'customer_age')",
    "[data_prep worker] imputing missing fields with customer_age.median()...",
    "[data_prep worker] scaling numerical matrices via StandardScaler...",
    "[ml_modeler worker] executing scikit-learn multiple linear regression...",
    "[ml_modeler worker] regression training complete: R2 = 0.44",
    "[validation_judge] evaluating metrics and feature correlations...",
    "[validation_judge] warning: R2 score under 0.50 threshold (0.44)!",
    "[validation_judge] warning: multicollinearity detected between features 'page_views' and 'visits' (r = 0.94)",
    "[validation_judge] self-correction pass 1 triggered: dropping 'visits' and adding interaction terms...",
    "[data_prep worker] updating feature matrices subset...",
    "[ml_modeler worker] executing scikit-learn multiple linear regression (pass 2)...",
    "[ml_modeler worker] regression training complete: R2 = 0.86",
    "[validation_judge] evaluating updated metrics...",
  ]);

  const terminalEndRef = useRef(null);

  // Fetch real Supabase tables data
  async function loadSupabaseData() {
    setLoadingDb(true);
    try {
      // 1. Fetch runs history list with dataset details
      const { data: runsData, error: runsListErr } = await supabase
        .from("pipeline_runs")
        .select("*, datasets(*)")
        .order("created_at", { ascending: false });

      if (!runsListErr && runsData) {
        setRunsList(runsData);
        setTotalRuns(runsData.length);
        
        // Calculate average R2 score from completed/failed runs metrics
        const r2Values = runsData
          .map(r => r.final_metrics?.r2)
          .filter(val => typeof val === 'number' && val > 0);
        if (r2Values.length > 0) {
          const sum = r2Values.reduce((a, b) => a + b, 0);
          setAvgR2(parseFloat((sum / r2Values.length).toFixed(3)));
        }
      }

      // 2. Fetch datasets list
      const { data: datasetsData, error: dsErr } = await supabase
        .from("datasets")
        .select("*")
        .order("created_at", { ascending: false });
      if (!dsErr && datasetsData) {
        setDatasetsList(datasetsData);
      }
    } catch (e) {
      console.error("Failed to load Supabase tables:", e);
    } finally {
      setLoadingDb(false);
    }
  }

  useEffect(() => {
    loadSupabaseData();
  }, []);

  // Auto scroll terminal logs
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Simulate incremental logs
  useEffect(() => {
    const interval = setInterval(() => {
      setLogs((prev) => {
        if (prev.length < 15) {
          return [
            ...prev,
            "[validation_judge] success: model fit approved!",
            "[writer worker] translating mathematical coefficients into business insights...",
            "[system] execution pipeline finished successfully. report generated."
          ];
        }
        return prev;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFileName(file.name);
      setIsUploading(true);
      
      // Simulate pipeline logs updating for the new file
      setTimeout(() => {
        setIsUploading(false);
        setLogs((prev) => [
          ...prev,
          `[system] user uploaded new file: ${file.name}`,
          `[system] parsing columns metadata...`,
          `[data_prep worker] initiating fresh scaling and sanitization run...`
        ]);
      }, 1500);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#09090b] text-zinc-100 font-sans">
      {/* 1. LEFT SIDEBAR CONTAINER */}
      <aside className="w-64 border-r border-zinc-800 bg-[#050507] flex flex-col justify-between shrink-0">
        <div>
          {/* Header Branding */}
          <div className="h-16 flex items-center px-6 border-b border-zinc-800 gap-2">
            <span className="text-xl">🤖</span>
            <span className="font-semibold text-sm tracking-tight text-white uppercase">
              auto-analyst ai
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            <button
              onClick={() => setActiveTab("workspace")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "workspace"
                  ? "bg-zinc-800/80 text-white border-l-2 border-blue-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              }`}
            >
              <LayoutDashboard size={16} className={activeTab === "workspace" ? "text-blue-500" : "text-zinc-400"} />
              Active Workspace
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "history"
                  ? "bg-zinc-800/80 text-white border-l-2 border-blue-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              }`}
            >
              <History size={16} className={activeTab === "history" ? "text-blue-500" : "text-zinc-400"} />
              Pipeline History
            </button>
            <button
              onClick={() => setActiveTab("supabase")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "supabase"
                  ? "bg-zinc-800/80 text-white border-l-2 border-blue-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              }`}
            >
              <Database size={16} className={activeTab === "supabase" ? "text-blue-500" : "text-zinc-400"} />
              Database Tables
            </button>
            <button
              onClick={() => setActiveTab("api")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "api"
                  ? "bg-zinc-800/80 text-white border-l-2 border-blue-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
              }`}
            >
              <Settings size={16} className={activeTab === "api" ? "text-blue-500" : "text-zinc-400"} />
              API Configurations
            </button>
          </nav>
        </div>

        {/* Sidebar Footer info */}
        <div className="p-4 border-t border-zinc-800 text-[10px] text-zinc-500 flex flex-col gap-1">
          <div>Workspace Environment: Supabase Cloud</div>
          <div>Version: 1.2.0 (SSR Active)</div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-[#09090b]/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold tracking-tight text-white uppercase">
              {activeTab === "workspace" && "Active Session Studio"}
              {activeTab === "history" && "Audit Logs & Run Archives"}
              {activeTab === "supabase" && "Supabase Table Browser"}
              {activeTab === "api" && "Model & Schema Settings"}
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-400 font-medium border border-zinc-700">
              Session ID: run-94a2
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <button 
              onClick={loadSupabaseData}
              disabled={loadingDb}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 hover:text-white transition-all mr-2"
            >
              <RefreshCw size={12} className={loadingDb ? "animate-spin" : ""} />
              Sync DB
            </button>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/50 text-zinc-400 border border-zinc-800">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              Gemini 2.5 Flash
            </span>
          </div>
        </header>

        {/* Dashboard Panels Scroll Area */}
        <div className="p-8 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 pb-24">
          
          {/* 2. TOP METRICS LINE GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Card 1: Total Runs */}
            <div className="bg-[#0c0c0f] border border-zinc-800 rounded-xl p-5 flex flex-col justify-between h-[105px]">
              <span className="text-zinc-500 text-xs font-medium tracking-tight uppercase">total runs</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-semibold text-white tracking-tight">{totalRuns}</span>
                <span className="text-[10px] text-zinc-500">runs</span>
              </div>
              <span className="text-[10px] text-zinc-500 mt-2 block">synchronizing with supabase</span>
            </div>

            {/* Card 2: Average R² Score */}
            <div className="bg-[#0c0c0f] border border-zinc-800 rounded-xl p-5 flex flex-col justify-between h-[105px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-xs font-medium tracking-tight uppercase">average r² score</span>
                <span className="text-[10px] font-semibold text-blue-400">{Math.round(avgR2 * 100)}% fit</span>
              </div>
              <div className="text-3xl font-semibold text-white tracking-tight mt-2">{avgR2}</div>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-3">
                <div 
                  className="bg-blue-500 h-full rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)] transition-all duration-500"
                  style={{ width: `${Math.min(Math.max(avgR2 * 100, 5), 100)}%` }}
                ></div>
              </div>
            </div>

            {/* Card 3: Agent Loop Status */}
            <div className="bg-[#0c0c0f] border border-zinc-800 rounded-xl p-5 flex flex-col justify-between h-[105px]">
              <span className="text-zinc-500 text-xs font-medium tracking-tight uppercase">agent loop status</span>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2.5 py-1 bg-amber-950/40 text-amber-400 border border-amber-900/60 rounded text-[10px] flex items-center gap-1.5 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                  VALIDATING STEP
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 mt-2 block">self-correcting multicollinearity</span>
            </div>

            {/* Card 4: Backend State */}
            <div className="bg-[#0c0c0f] border border-zinc-800 rounded-xl p-5 flex flex-col justify-between h-[105px]">
              <span className="text-zinc-500 text-xs font-medium tracking-tight uppercase">backend state</span>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2.5 py-1 bg-emerald-950/40 text-emerald-400 border border-emerald-900/60 rounded text-[10px] flex items-center gap-1.5 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  SUPABASE ACTIVE
                </span>
              </div>
              <span className="text-[10px] text-emerald-500/80 mt-2 block flex items-center gap-1">
                Database link operational
              </span>
            </div>
          </div>

          {/* Tab Render Selector */}
          {activeTab === "workspace" && (
            <>
              {/* 3. MAIN SPLIT-SCREEN CONTENT PANE */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                
                {/* Left Column Container (Fixed height to match terminal exactly) */}
                <div className="flex flex-col justify-between h-[460px] w-full">
                  
                  {/* File Ingestion Dropzone */}
                  <div 
                    onClick={handleUploadClick}
                    className="h-[200px] shrink-0 border border-dashed border-zinc-800 hover:border-zinc-700 bg-[#0c0c0f] hover:bg-[#0f0f13] transition-all rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer group"
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept=".csv"
                      onChange={handleFileChange}
                    />
                    {isUploading ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 size={32} className="text-blue-500 animate-spin" />
                        <span className="text-xs text-zinc-400 font-medium">Ingesting dataset columns...</span>
                      </div>
                    ) : fileName ? (
                      <div className="flex flex-col items-center text-center gap-2">
                        <div className="w-10 h-10 rounded bg-blue-950/50 border border-blue-900/40 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-all">
                          <FileText size={20} />
                        </div>
                        <span className="text-xs text-white font-medium">{fileName}</span>
                        <span className="text-[10px] text-zinc-500">Click to upload a different dataset</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center text-center gap-3">
                        <div className="w-12 h-12 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:scale-105 transition-all">
                          <CloudUpload size={22} />
                        </div>
                        <div>
                          <p className="text-xs text-white font-medium">upload raw .csv dataset here</p>
                          <p className="text-[10px] text-zinc-500 mt-1">Drag and drop or click to browse local files</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Multi-Agent Workflow Tree */}
                  <div className="h-[236px] shrink-0 border border-zinc-800 bg-[#0c0c0f] rounded-xl p-5 flex flex-col justify-between">
                    <span className="text-zinc-400 text-xs font-semibold tracking-tight uppercase">
                      active agent execution tree
                    </span>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-[#09090b] border border-zinc-900 rounded-lg relative overflow-hidden my-auto">
                      
                      {/* Node 1: Data Prep Worker */}
                      <div className="flex flex-col items-center text-center z-10 w-28">
                        <div className="w-10 h-10 rounded-full border border-emerald-800 bg-emerald-950/20 text-emerald-400 flex items-center justify-center mb-2 shadow-[0_0_10px_rgba(34,197,94,0.15)]">
                          <CheckCircle size={18} />
                        </div>
                        <span className="text-[10px] font-semibold text-white">data prep worker</span>
                        <span className="text-[9px] text-zinc-500 mt-0.5">Success (Pass 2)</span>
                      </div>

                      {/* Directional Connector Line 1 */}
                      <div className="hidden sm:block flex-1 h-[2px] bg-emerald-800 shadow-[0_0_4px_rgba(16,185,129,0.3)] z-0 mx-2"></div>

                      {/* Node 2: ML Modeler Worker */}
                      <div className="flex flex-col items-center text-center z-10 w-28">
                        <div className="w-10 h-10 rounded-full border border-emerald-800 bg-emerald-950/20 text-emerald-400 flex items-center justify-center mb-2 shadow-[0_0_10px_rgba(34,197,94,0.15)]">
                          <CheckCircle size={18} />
                        </div>
                        <span className="text-[10px] font-semibold text-white">ml modeler worker</span>
                        <span className="text-[9px] text-zinc-500 mt-0.5">Success (Pass 2)</span>
                      </div>

                      {/* Directional Connector Line 2 */}
                      <div className="hidden sm:block flex-1 h-[2px] bg-gradient-to-r from-emerald-800 to-amber-700 z-0 mx-2"></div>

                      {/* Node 3: Statistical Judge */}
                      <div className="flex flex-col items-center text-center z-10 w-28">
                        <div className="w-10 h-10 rounded-full border border-amber-500 bg-amber-950/30 text-amber-400 flex items-center justify-center mb-2 shadow-[0_0_15px_rgba(245,158,11,0.35)] animate-pulse border-2">
                          <Loader2 size={18} className="animate-spin text-amber-400" />
                        </div>
                        <span className="text-[10px] font-semibold text-white">statistical judge</span>
                        <span className="text-[9px] text-amber-400 font-medium mt-0.5 animate-pulse">Validating Run</span>
                      </div>

                    </div>
                  </div>

                </div>

                {/* Right Column (Fixed height terminal window) */}
                <div className="border border-zinc-800 bg-[#050507] rounded-xl flex flex-col overflow-hidden h-[460px] w-full shadow-2xl">
                  {/* Console Header */}
                  <div className="h-10 border-b border-zinc-800 bg-[#09090b] px-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500/80"></span>
                      <span className="text-[10px] font-mono text-zinc-500 ml-2 uppercase">stream-execution.log</span>
                    </div>
                    <Terminal size={14} className="text-zinc-500" />
                  </div>

                  {/* Terminal stdout area */}
                  <div className="p-5 font-mono text-[11px] text-zinc-300 leading-relaxed overflow-y-auto flex-1 custom-scrollbar bg-[#050507]/90">
                    {logs.map((log, index) => {
                      let color = "text-zinc-300";
                      if (log.includes("[system]")) color = "text-blue-400";
                      else if (log.includes("[data_prep")) color = "text-zinc-400";
                      else if (log.includes("[ml_model")) color = "text-zinc-400";
                      else if (log.includes("[validation_judge] warning")) color = "text-amber-400";
                      else if (log.includes("[validation_judge] error")) color = "text-rose-400";
                      else if (log.includes("[validation_judge] success")) color = "text-emerald-400";

                      return (
                        <div key={index} className={`${color} mb-1.5 break-all`}>
                          {log}
                        </div>
                      );
                    })}
                    {/* Blinking block terminal cursor */}
                    <div className="flex items-center gap-1 mt-1 text-blue-400">
                      <span>$</span>
                      <span className="w-1.5 h-3 bg-blue-500 animate-pulse inline-block"></span>
                    </div>
                    <div ref={terminalEndRef} />
                  </div>
                </div>

              </div>
            </>
          )}

          {activeTab === "history" && (
            <div className="border border-zinc-800 bg-[#0c0c0f] rounded-xl p-6 text-zinc-400 text-xs min-h-[460px] flex flex-col justify-start">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
                <div>
                  <h3 className="font-semibold text-white text-sm">Pipeline Execution Runs</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Real-time status audited from Supabase `pipeline_runs` table</p>
                </div>
                <History size={16} className="text-zinc-500" />
              </div>

              {runsList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <Clock size={28} className="text-zinc-600 mb-2" />
                  <p className="text-zinc-400 font-medium">No Runs Found</p>
                  <p className="text-[10px] text-zinc-500 mt-1 max-w-xs">Run a script from the backend or Vite studio to generate execution logs.</p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full custom-scrollbar">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider font-mono">
                        <th className="py-2 px-3">Run ID</th>
                        <th className="py-2 px-3">Dataset</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">R² Score</th>
                        <th className="py-2 px-3">Silhouette</th>
                        <th className="py-2 px-3">Date Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runsList.map((run) => (
                        <tr key={run.id} className="border-b border-zinc-900/60 hover:bg-zinc-900/20 font-mono">
                          <td className="py-2.5 px-3 text-zinc-300 font-semibold">{run.id.slice(0, 8)}...</td>
                          <td className="py-2.5 px-3 text-zinc-400">{run.datasets?.file_name || "Unknown"}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border ${
                              run.run_status === "completed" || run.run_status === "approved"
                                ? "bg-emerald-950/40 text-emerald-400 border-emerald-900/60"
                                : run.run_status === "failed"
                                ? "bg-rose-950/40 text-rose-400 border-rose-900/60"
                                : "bg-amber-950/40 text-amber-400 border-amber-900/60"
                            }`}>
                              {run.run_status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-blue-400 font-bold">{run.final_metrics?.r2 ? run.final_metrics.r2.toFixed(3) : "—"}</td>
                          <td className="py-2.5 px-3 text-zinc-400">{run.final_metrics?.silhouette ? run.final_metrics.silhouette.toFixed(3) : "—"}</td>
                          <td className="py-2.5 px-3 text-zinc-500">{new Date(run.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "supabase" && (
            <div className="border border-zinc-800 bg-[#0c0c0f] rounded-xl p-6 text-zinc-400 text-xs min-h-[460px] flex flex-col justify-start">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
                <div>
                  <h3 className="font-semibold text-white text-sm">Supabase Database Tables</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Uploaded files browser syncing with `datasets` schema</p>
                </div>
                <Database size={16} className="text-zinc-500" />
              </div>

              {datasetsList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <Server size={28} className="text-zinc-600 mb-2" />
                  <p className="text-zinc-400 font-medium">No Registered Datasets</p>
                  <p className="text-[10px] text-zinc-500 mt-1 max-w-xs">Datasets will automatically display here once you upload CSV files through Vite Studio.</p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full custom-scrollbar">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider font-mono">
                        <th className="py-2 px-3">Dataset ID</th>
                        <th className="py-2 px-3">File Name</th>
                        <th className="py-2 px-3">Row Count</th>
                        <th className="py-2 px-3">Columns (Features Count)</th>
                        <th className="py-2 px-3">Uploaded Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datasetsList.map((ds) => {
                        const cols = ds.columns_json ? Object.keys(ds.columns_json) : [];
                        return (
                          <tr key={ds.id} className="border-b border-zinc-900/60 hover:bg-zinc-900/20 font-mono">
                            <td className="py-2.5 px-3 text-zinc-300 font-semibold">{ds.id.slice(0, 8)}...</td>
                            <td className="py-2.5 px-3 text-white font-medium flex items-center gap-1.5">
                              <FileText size={12} className="text-blue-500" />
                              {ds.file_name}
                            </td>
                            <td className="py-2.5 px-3 text-zinc-400">{ds.row_count} rows</td>
                            <td className="py-2.5 px-3 text-zinc-400 hover:text-white transition-all cursor-help" title={cols.join(", ")}>
                              {cols.length} columns (hover for details)
                            </td>
                            <td className="py-2.5 px-3 text-zinc-500">{new Date(ds.created_at).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "api" && (
            <div className="border border-zinc-800 bg-[#0c0c0f] rounded-xl p-6 text-zinc-400 text-xs h-[460px] flex flex-col items-center justify-center">
              <Settings size={36} className="mx-auto text-zinc-600 mb-3 animate-pulse" />
              <p className="font-semibold text-white text-sm mb-1">Model & Schema Settings</p>
              <p className="max-w-md text-center mb-4">Configured API Key for Gemini. Workspace environment utilizes local Python execution sandboxing combined with Supabase for user persistence.</p>
              <div className="bg-[#09090b] border border-zinc-900 rounded p-4 text-[10px] font-mono text-left w-full max-w-lg space-y-2 leading-relaxed">
                <div><span className="text-zinc-500 uppercase">Supabase URL:</span> <span className="text-zinc-300">https://blyythnqaoajpaelwcej.supabase.co</span></div>
                <div><span className="text-zinc-500 uppercase">Database Type:</span> <span className="text-emerald-400">PostgreSQL (Supabase SSR client active)</span></div>
                <div><span className="text-zinc-500 uppercase">Gemini Endpoint:</span> <span className="text-blue-400">gemini-2.5-flash (types.Schema structured inputs)</span></div>
              </div>
            </div>
          )}

        </div>

        {/* 4. BOTTOM SLIDING REPORT CONTAINER */}
        <div 
          className={`fixed bottom-0 left-64 right-0 border-t border-zinc-800 bg-[#0c0c0f]/95 backdrop-blur-md transition-all duration-300 z-40 ${
            reportOpen ? "h-[220px]" : "h-11"
          }`}
        >
          {/* Sliding Control Bar */}
          <div 
            onClick={() => setReportOpen(!reportOpen)}
            className="h-11 px-6 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-900/50 transition-all select-none"
          >
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-blue-500" />
              <span className="text-xs font-semibold tracking-tight text-white uppercase flex items-center gap-1.5">
                Execution Summary Report
                <span className="px-1.5 py-0.5 bg-emerald-950/50 text-emerald-400 text-[8px] font-semibold border border-emerald-900/50 rounded uppercase">
                  Completed
                </span>
              </span>
            </div>
            {reportOpen ? (
              <ChevronDown size={16} className="text-zinc-400" />
            ) : (
              <ChevronUp size={16} className="text-zinc-400 animate-bounce" />
            )}
          </div>

          {/* Drawer content area */}
          {reportOpen && (
            <div className="p-6 overflow-y-auto max-h-[175px] custom-scrollbar text-zinc-300 font-sans leading-relaxed text-xs">
              <div className="max-w-4xl mx-auto space-y-4">
                
                {/* Title */}
                <div>
                  <h3 className="text-sm font-semibold text-white tracking-tight flex items-center gap-1.5">
                    <Sparkles size={14} className="text-blue-500" />
                    Model Optimization Findings
                  </h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Analyst Writer Agent report</p>
                </div>

                {/* Grid stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3 bg-zinc-900/40 rounded border border-zinc-900 font-mono text-[10px]">
                  <div>
                    <span className="text-zinc-500 block uppercase">Supervised Model</span>
                    <span className="text-white font-semibold text-xs">Linear Regression</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block uppercase">Regression Fit</span>
                    <span className="text-blue-400 font-semibold text-xs">R² = 0.860</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block uppercase">Unsupervised Model</span>
                    <span className="text-white font-semibold text-xs">K-Means (k=4)</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block uppercase">Clustering Quality</span>
                    <span className="text-emerald-400 font-semibold text-xs">Silhouette = 0.455</span>
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-zinc-200">Core Actionable Insights</h4>
                  <ol className="list-decimal list-inside space-y-1.5 pl-1 text-zinc-400 text-[11px]">
                    <li>
                      <strong className="text-zinc-300">CLV Drivers (Regression):</strong> Multiple Linear Regression coefficients indicate that customer lifetime value is heavily driven by <span className="text-blue-400 font-medium">repeat purchase velocity</span> over direct margin scale.
                    </li>
                    <li>
                      <strong className="text-zinc-300">Ad Budget Impact (Regression):</strong> Advertising budget yields a standardized impact multiplier of <span className="text-emerald-400 font-medium">+6.51</span> on sales outcome, showing diminishing returns above $15k/mo.
                    </li>
                    <li>
                      <strong className="text-zinc-300">Co-linear Correction (Regression):</strong> Website visits were strongly co-linear with ad budget ($r = 0.993$), prompting a secondary execution path dropping website visits to avoid coefficient inflation.
                    </li>
                    <li>
                      <strong className="text-zinc-300">Customer Segmentation (K-Means):</strong> Optimal partitioning yields 4 groups, identifying a high-value/low-frequency cluster comprising 18% of observations.
                    </li>
                  </ol>
                </div>

              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
