import { Suspense } from "react";
import { connection } from "next/server";
import { Counter } from "./Counter";

async function SuspendedServerChild() {
  await connection();
  await new Promise((r) => setTimeout(r, 50));
  return (
    <div id="streamed">
      <p>streamed</p>
      <Counter label="suspended" />
    </div>
  );
}

export default function Page() {
  return (
    <main>
      <h1>cacheComponents hydration repro</h1>
      <div id="control"><Counter label="shell" /></div>
      <Suspense fallback={<p id="fallback">loading…</p>}>
        <SuspendedServerChild />
      </Suspense>
    </main>
  );
}
