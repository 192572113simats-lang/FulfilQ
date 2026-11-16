import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { Role } from '@fulfilliq/shared';
import { ApiError, apiFetch } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

type ImportDataset = 'users' | 'inventory' | 'orders';
type ExportDataset = 'users' | 'inventory' | 'orders' | 'returns' | 'audit';

interface CsvFileStatus {
  dataset: ExportDataset;
  fileName: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

interface CsvStatusResponse {
  storageMode: string;
  sqlitePath: string;
  csvDir: string;
  files: CsvFileStatus[];
}

interface CsvImportReport {
  dataset: ImportDataset;
  createdCount: number;
  updatedCount: number;
  errors: Array<{ row: number; message: string }>;
}

const IMPORT_OPTIONS: Array<{
  dataset: ImportDataset;
  label: string;
  description: string;
  roles: Role[];
}> = [
  {
    dataset: 'users',
    label: 'User Accounts (users.csv)',
    description: 'Create or update local user accounts with email, password, phone, role, and warehouse assignment.',
    roles: [Role.ADMIN],
  },
  {
    dataset: 'inventory',
    label: 'Inventory & Stock (inventory.csv)',
    description: 'Add new catalog SKUs or update prices, thresholds, and available warehouse stock levels.',
    roles: [Role.ADMIN, Role.STORE_MANAGER],
  },
  {
    dataset: 'orders',
    label: 'Sales & Orders (orders_sales.csv)',
    description: 'Import orders with atomic stock reservation, regional tax/shipping calculation, and optional LocalStub settlement.',
    roles: [Role.ADMIN, Role.STORE_MANAGER, Role.CUSTOMER],
  },
];

const EXPORT_OPTIONS: Array<{
  dataset: ExportDataset;
  label: string;
  fileName: string;
  roles: Role[];
}> = [
  { dataset: 'users', label: 'User Directory', fileName: 'users.csv', roles: [Role.ADMIN] },
  {
    dataset: 'inventory',
    label: 'Inventory & Warehouse Stock',
    fileName: 'inventory.csv',
    roles: [Role.ADMIN, Role.STORE_MANAGER, Role.PICKER],
  },
  {
    dataset: 'orders',
    label: 'Orders & Sales Ledger',
    fileName: 'orders_sales.csv',
    roles: [Role.ADMIN, Role.STORE_MANAGER, Role.FINANCE_REVIEWER, Role.SUPPORT_AGENT],
  },
  {
    dataset: 'returns',
    label: 'Returns & Refunds Queue',
    fileName: 'returns.csv',
    roles: [Role.ADMIN, Role.FINANCE_REVIEWER, Role.SUPPORT_AGENT],
  },
  {
    dataset: 'audit',
    label: 'Append-Only Audit Trail',
    fileName: 'audit_logs.csv',
    roles: [Role.ADMIN, Role.FINANCE_REVIEWER, Role.SUPPORT_AGENT],
  },
];

function triggerCsvDownload(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function CsvManagerPage() {
  const { user, announce } = useAuth();
  const [statusData, setStatusData] = useState<CsvStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const allowedImports = useMemo(
    () => (user ? IMPORT_OPTIONS.filter((opt) => opt.roles.includes(user.role)) : []),
    [user]
  );
  const allowedExports = useMemo(
    () => (user ? EXPORT_OPTIONS.filter((opt) => opt.roles.includes(user.role)) : []),
    [user]
  );

  const [selectedImport, setSelectedImport] = useState<ImportDataset>('orders');
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<CsvImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (allowedImports.length > 0 && !allowedImports.some((o) => o.dataset === selectedImport)) {
      setSelectedImport(allowedImports[0].dataset);
    }
  }, [allowedImports, selectedImport]);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const data = await apiFetch<CsvStatusResponse>('/api/csv/status');
      setStatusData(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load local CSV status');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const loadSampleTemplate = async (dataset: ImportDataset, downloadAlso = false) => {
    setError(null);
    setReport(null);
    try {
      const template = await apiFetch<string>(`/api/csv/template/${dataset}`);
      setCsvText(template);
      if (downloadAlso) {
        triggerCsvDownload(`template_${dataset}.csv`, template);
      }
      announce(`Loaded ${dataset} CSV template`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load sample template');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setReport(null);
    try {
      const text = await file.text();
      setCsvText(text);
      setStatusMessage(`Loaded local CSV file "${file.name}" (${text.length} bytes). Review and click Import.`);
      announce(`Loaded CSV file ${file.name}`);
    } catch {
      setError('Failed to read selected CSV file');
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);
    setReport(null);
    if (!csvText.trim()) {
      setError('Paste CSV content or upload a .csv file before importing.');
      return;
    }
    setImporting(true);
    try {
      const res = await apiFetch<{ report: CsvImportReport }>(`/api/csv/import/${selectedImport}`, {
        method: 'POST',
        body: JSON.stringify({ csvText }),
      });
      setReport(res.report);
      await loadStatus();
      const summary = `CSV import complete: ${res.report.createdCount} created, ${res.report.updatedCount} updated, ${res.report.errors.length} error(s).`;
      setStatusMessage(summary);
      announce(summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleForceSync = async () => {
    setError(null);
    setStatusMessage(null);
    setSyncing(true);
    try {
      await apiFetch('/api/csv/sync', { method: 'POST' });
      await loadStatus();
      setStatusMessage('All local SQLite tables synced to disk CSV files.');
      announce('Local CSV files synced');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sync local CSV files');
    } finally {
      setSyncing(false);
    }
  };

  const handleExportDownload = async (dataset: ExportDataset, fileName: string) => {
    setError(null);
    try {
      const csv = await apiFetch<string>(`/api/csv/export/${dataset}`);
      triggerCsvDownload(fileName, csv);
      announce(`Downloaded ${fileName}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to export ${fileName}`);
    }
  };

  const canManualSync =
    user?.role === Role.ADMIN ||
    user?.role === Role.STORE_MANAGER ||
    user?.role === Role.FINANCE_REVIEWER;

  const estimatedDataRows = useMemo(() => {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return Math.max(0, lines.length - 1);
  }, [csvText]);

  const activeImportMeta = allowedImports.find((opt) => opt.dataset === selectedImport);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Local CSV Database & Bulk Import</h1>
          <p className="mt-1 text-sm text-slate-600">
            All users, inventory, sales orders, returns, and audit records are stored locally in SQLite and mirrored to local CSV files on disk.
          </p>
        </div>

        {canManualSync && (
          <button
            type="button"
            onClick={handleForceSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors min-h-[44px] whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing Disk CSVs...' : 'Sync Local CSV Now'}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {statusMessage && (
        <div role="status" className="p-4 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          {statusMessage}
        </div>
      )}

      {/* Section 1: Local Disk Persistence Status */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Local Disk Storage Mirrors</h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Every registration, import, and order lifecycle change persists locally without external cloud dependencies.
            </p>
          </div>
          {statusData && (
            <div className="text-xs font-mono text-slate-600 space-y-0.5 sm:text-right">
              <div>DB: {statusData.sqlitePath}</div>
              <div>CSV: {statusData.csvDir}</div>
            </div>
          )}
        </div>

        {loadingStatus ? (
          <div className="h-32 mt-4 bg-slate-100 rounded animate-pulse" />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pr-4">Dataset</th>
                  <th className="py-2.5 pr-4">Local CSV File</th>
                  <th className="py-2.5 pr-4">Disk Status</th>
                  <th className="py-2.5 pr-4">Size</th>
                  <th className="py-2.5">Last Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {statusData?.files.map((f) => (
                  <tr key={f.dataset}>
                    <td className="py-3 pr-4 font-medium text-slate-900 capitalize">{f.dataset}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-700">{f.fileName}</td>
                    <td className="py-3 pr-4 text-xs font-medium">
                      <span className={f.exists ? 'text-emerald-700' : 'text-amber-700'}>
                        {f.exists ? 'Synced on disk' : 'Pending first sync'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono tabular-nums text-xs text-slate-600">
                      {f.sizeBytes.toLocaleString()} B
                    </td>
                    <td className="py-3 font-mono tabular-nums text-xs text-slate-600">
                      {f.updatedAt ? new Date(f.updatedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Section 2: Import CSV into Local DB */}
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Upload className="w-5 h-5 text-blue-700" />
            <h2 className="text-lg font-semibold text-slate-900">Import Records from CSV File</h2>
          </div>

          <form onSubmit={handleImportSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label htmlFor="csv-dataset-select" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Target dataset
                </label>
                <select
                  id="csv-dataset-select"
                  value={selectedImport}
                  onChange={(e) => {
                    setSelectedImport(e.target.value as ImportDataset);
                    setReport(null);
                    setError(null);
                  }}
                  className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:border-blue-700"
                >
                  {allowedImports.map((opt) => (
                    <option key={opt.dataset} value={opt.dataset}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => loadSampleTemplate(selectedImport, false)}
                  className="px-3 py-2.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors min-h-[42px]"
                >
                  Load Sample CSV
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleTemplate(selectedImport, true)}
                  className="px-3 py-2.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors min-h-[42px]"
                >
                  Download Template
                </button>
              </div>
            </div>

            {activeImportMeta && (
              <p className="text-xs text-slate-600">{activeImportMeta.description}</p>
            )}

            <div>
              <label htmlFor="csv-file-upload" className="block text-sm font-medium text-slate-700 mb-1.5">
                Upload local .csv file
              </label>
              <input
                id="csv-file-upload"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="block w-full text-sm text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-800 hover:file:bg-slate-100"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="csv-textarea" className="block text-sm font-medium text-slate-700">
                  CSV content preview / editor
                </label>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {estimatedDataRows} data row(s)
                </span>
              </div>
              <textarea
                id="csv-textarea"
                rows={8}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Click 'Load Sample CSV' or choose a .csv file above..."
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:border-blue-700"
              />
            </div>

            <button
              type="submit"
              disabled={importing || allowedImports.length === 0}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors min-h-[44px]"
            >
              {importing ? 'Importing into Local Database...' : 'Import CSV & Sync Local DB'}
            </button>
          </form>

          {report && (
            <div className="mt-6 border border-slate-200 rounded-md p-4 bg-slate-50 space-y-3">
              <div className="flex flex-wrap items-center gap-6 text-sm">
                <div>
                  <span className="text-slate-500">Dataset:</span>{' '}
                  <span className="font-semibold text-slate-900 uppercase">{report.dataset}</span>
                </div>
                <div>
                  <span className="text-slate-500">Created:</span>{' '}
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {report.createdCount}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Updated:</span>{' '}
                  <span className="font-mono font-semibold text-blue-700 tabular-nums">
                    {report.updatedCount}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Errors:</span>{' '}
                  <span className="font-mono font-semibold text-red-700 tabular-nums">
                    {report.errors.length}
                  </span>
                </div>
              </div>

              {report.errors.length > 0 && (
                <ul className="space-y-1 text-xs text-red-800 list-disc pl-5">
                  {report.errors.map((errItem, idx) => (
                    <li key={idx}>
                      <span className="font-mono font-semibold">Row {errItem.row}:</span> {errItem.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Section 3: Export Local CSV Datasets */}
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-700" />
            <h2 className="text-lg font-semibold text-slate-900">Export Local CSVs</h2>
          </div>
          <p className="text-xs text-slate-600 mb-5">
            Downloads are scoped by your server-side role permissions; password hashes are never exported and PII is masked when required.
          </p>

          {allowedExports.length === 0 ? (
            <p className="text-sm text-slate-600">
              Customer accounts export is restricted to staff roles. You can download and upload your own Orders CSV on the left.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
              {allowedExports.map((exp) => (
                <div key={exp.dataset} className="p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{exp.label}</div>
                    <div className="text-xs font-mono text-slate-500">{exp.fileName}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleExportDownload(exp.dataset, exp.fileName)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors shrink-0 min-h-[38px]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
