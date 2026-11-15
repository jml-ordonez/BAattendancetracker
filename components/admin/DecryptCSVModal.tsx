"use client";

import React, { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  LockKeyhole,
  RotateCcw,
  Search,
  UploadCloud,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { btn, input } from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import { formatSection, formatStudentId } from "@/lib/format";
import type { CSVAttendanceRow } from "@/lib/export/csv-generator";

interface DecryptCSVModalProps {
  open: boolean;
  onClose: () => void;
}

export function DecryptCSVModal({ open, onClose }: DecryptCSVModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "paste">("file");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decrypted output state
  const [decryptedCSV, setDecryptedCSV] = useState<string | null>(null);
  const [decryptedRows, setDecryptedRows] = useState<CSVAttendanceRow[]>([]);
  const [metadata, setMetadata] = useState<{ exportedAt?: string; rowCount?: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setRawText("");
    setError(null);
    setDecryptedCSV(null);
    setDecryptedRows([]);
    setMetadata(null);
    setSearchQuery("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setError(null);
    }
  };

  const handleDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let contentToDecrypt = rawText.trim();
    if (inputMode === "file") {
      if (!file) {
        setError("Please select or drop an encrypted attendance file to decrypt.");
        return;
      }
      try {
        contentToDecrypt = await file.text();
      } catch {
        setError("Could not read the uploaded file. Please select it again.");
        return;
      }
    }

    if (!contentToDecrypt) {
      setError("No encrypted content provided to decrypt.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/reports/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: contentToDecrypt,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Decryption failed. Please make sure the file was exported from this attendance system.");
        return;
      }

      setDecryptedCSV(data.csv || "");
      setDecryptedRows(data.rows || []);
      setMetadata(data.metadata || null);
    } catch {
      setError("Failed to connect to the server for decryption. Please check your network connection.");
    } finally {
      setLoading(false);
    }
  };

  const downloadDecrypted = () => {
    if (!decryptedCSV) return;
    const blob = new Blob([decryptedCSV.startsWith("\uFEFF") ? decryptedCSV : "\uFEFF" + decryptedCSV], {
      type: "text/csv; charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BA_Attendance_Decrypted_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredRows = decryptedRows.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.studentName.toLowerCase().includes(q) ||
      r.studentIdNumber.toLowerCase().includes(q) ||
      r.section.toLowerCase().includes(q) ||
      r.eventTitle.toLowerCase().includes(q)
    );
  });

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      title="Decrypt attendance roll"
      description="Upload or paste an encrypted attendance file to view and verify the session roll. Exported attendance pairs each student's Time-in and Time-out into a single consolidated record."
    >
      {!decryptedCSV ? (
        <form onSubmit={handleDecrypt} noValidate className="space-y-6">
          {error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl bg-rose-soft p-4 text-sm font-medium text-rose">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">Decryption unsuccessful</p>
                <p className="text-rose/90">{error}</p>
              </div>
            </div>
          )}

          {/* Input Method Toggle */}
          <div className="flex rounded-lg bg-paper p-1">
            <button
              type="button"
              onClick={() => setInputMode("file")}
              className={cn(
                "press flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold transition-colors",
                inputMode === "file" ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"
              )}
            >
              <UploadCloud className="h-4 w-4" />
              Upload file
            </button>
            <button
              type="button"
              onClick={() => setInputMode("paste")}
              className={cn(
                "press flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold transition-colors",
                inputMode === "paste" ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"
              )}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Paste ciphertext
            </button>
          </div>

          {/* File Upload Zone */}
          {inputMode === "file" ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.enc,.json,.txt"
                onChange={handleFileChange}
                className="sr-only"
                id="enc-file-input"
              />
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all",
                  isDragging
                    ? "border-brand-dark bg-brand-tint"
                    : file
                    ? "border-brand bg-brand-soft/30"
                    : "border-line-strong hover:border-brand hover:bg-paper"
                )}
              >
                {file ? (
                  <div className="flex flex-col items-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                      <FileSpreadsheet className="h-6 w-6" />
                    </span>
                    <p className="mt-3 font-semibold text-ink">{file.name}</p>
                    <p className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB · Click to choose a different file</p>
                  </div>
                ) : (
                  <>
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper text-muted">
                      <UploadCloud className="h-6 w-6" />
                    </span>
                    <p className="mt-3 text-sm font-semibold text-ink">
                      Click to choose or drag & drop encrypted file
                    </p>
                    <p className="mt-1 text-xs text-muted">Accepts encrypted attendance files (.enc.csv, .enc, or JSON)</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="enc-paste-input" className="mb-1.5 block text-sm font-medium text-ink">
                Encrypted payload or JSON envelope
              </label>
              <textarea
                id="enc-paste-input"
                rows={5}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder='Paste {"format":"ba-enc-csv", ...} or ENC-CSV:v1:...'
                className={cn(input, "h-auto py-2 font-mono text-xs")}
              />
            </div>
          )}

          <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-xs text-ink-soft">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-ink" />
            <span>Attendance roll files pair each student&apos;s Time-in and Time-out scans into one combined row so students are not duplicated.</span>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={handleClose} className={btn.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className={cn(btn.primary, "px-6")}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Decrypting records…
                </>
              ) : (
                <>
                  <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                  Decrypt records
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        /* Decrypted View with Live Preview */
        <div className="space-y-6">
          <div className="flex flex-col gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-ink">File successfully decrypted & verified</p>
                <p className="text-xs text-muted">
                  Authenticated with AES-256-GCM · {decryptedRows.length} student roll records (paired Time-in & Time-out)
                  {metadata?.exportedAt ? ` · Exported on ${new Date(metadata.exportedAt).toLocaleDateString()}` : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={reset} className={btn.secondary}>
                <RotateCcw className="h-4 w-4" />
                Decrypt another
              </button>
              <button type="button" onClick={downloadDecrypted} className={btn.primary}>
                <Download className="h-4 w-4" />
                Download plain CSV
              </button>
            </div>
          </div>

          {/* Search Table */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search student, ID, or section..."
                className={cn(input, "h-10 pl-9 text-sm")}
              />
            </div>
            <p className="figures text-sm text-muted">
              Showing {filteredRows.length} of {decryptedRows.length} student{decryptedRows.length === 1 ? "" : "s"} on roll
            </p>
          </div>

          {/* Decrypted Table Preview */}
          <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
            <div className="max-h-[22rem] overflow-x-auto overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-line bg-paper text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Student</th>
                    <th className="px-3 py-3 font-semibold">Section</th>
                    <th className="px-3 py-3 font-semibold">Event · Session</th>
                    <th className="px-3 py-3 text-right font-semibold">Time In</th>
                    <th className="px-3 py-3 text-right font-semibold">Time Out</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-sm text-muted">
                        No records match your search.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r, i) => (
                      <tr key={`${r.studentIdNumber}-${i}`} className="hover:bg-brand-tint/40">
                        <td className="px-5 py-3">
                          <p className="font-semibold text-ink">{r.studentName}</p>
                          <p className="figures text-xs text-muted">{formatStudentId(r.studentIdNumber)}</p>
                        </td>
                        <td className="px-3 py-3 text-ink-soft">
                          <p>{formatSection(r.section)}</p>
                        </td>
                        <td className="max-w-[14rem] px-3 py-3">
                          <p className="truncate font-medium text-ink">{r.eventTitle}</p>
                          <p className="truncate text-xs text-muted">{r.sessionTitle}</p>
                        </td>
                        <td className="figures whitespace-nowrap px-3 py-3 text-right text-xs text-ink-soft">
                          {r.timeIn || "—"}
                        </td>
                        <td className="figures whitespace-nowrap px-3 py-3 text-right text-xs text-ink-soft">
                          {r.timeOut || "Inside"}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={r.finalStatus.includes("late") ? "late" : r.finalStatus.includes("left early") ? "left_early" : "checked_out"} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end border-t border-line pt-4">
            <button type="button" onClick={handleClose} className={btn.secondary}>
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
