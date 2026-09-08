"use client";
import { useState } from "react";
export function Counter({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return <button data-counter={label} onClick={() => setN((v) => v + 1)}>{label}: {n}</button>;
}
