import { Suspense } from "react";
import DealsClient from "./DealsClient";

export default function DealsPage() {
  return (
    <Suspense fallback={<div className="card"><p>Loading deals...</p></div>}>
      <DealsClient />
    </Suspense>
  );
}
