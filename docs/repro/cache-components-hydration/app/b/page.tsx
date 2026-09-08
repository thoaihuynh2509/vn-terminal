import { Suspense } from "react";
import { Counter } from "../Counter";

export default function Page() {
  return (
    <main>
      <div id="control"><Counter label="shell" /></div>
      <Suspense fallback={<p id="fallback">loading…</p>}>
        <Counter label="suspended" />
      </Suspense>
    </main>
  );
}
