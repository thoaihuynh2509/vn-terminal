import { Suspense } from "react";
import { Counter } from "../Counter";

async function SuspendedServerChild() {
  await Promise.resolve();
  return (
    <div id="streamed">
      <Counter label="suspended" />
    </div>
  );
}

export default function Page() {
  return (
    <main>
      <div id="control"><Counter label="shell" /></div>
      <Suspense fallback={<p id="fallback">loading…</p>}>
        <SuspendedServerChild />
      </Suspense>
    </main>
  );
}
