import { Dashboard } from "./components/layout/Dashboard";
import { DCAuthGate } from "./components/dc/DCAuthGate";
import { DCDashboard } from "./components/dc/DCDashboard";
import { useHash } from "./hooks/useHash";

function App() {
  const [hash] = useHash();
  const isDC = hash === "#/dc" || hash.startsWith("#/dc/");

  return (
    <div className="app-root">
      <div className="app-content">
        {isDC ? (
          <DCAuthGate>
            <DCDashboard />
          </DCAuthGate>
        ) : (
          <Dashboard />
        )}
      </div>
    </div>
  );
}

export default App;
