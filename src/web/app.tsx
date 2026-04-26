import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import "./styles.css";

const MailListPage = lazy(() => import("./pages/mail-list"));
const MailDetailPage = lazy(() => import("./pages/mail-detail"));
const MailActivityPage = lazy(() => import("./pages/mail-activity"));
const AdminPage = lazy(() => import("./pages/admin"));
const AgentFeedback = import.meta.env.DEV
  ? lazy(() => import("@runablehq/website-runtime").then((m) => ({ default: m.AgentFeedback })))
  : null;

function App() {
  return (
    <Provider>
      <Suspense
        fallback={
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: 14 }}>
            로딩 중...
          </div>
        }
      >
        <Switch>
          <Route path="/" component={MailListPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/mail/:aliasId" component={MailDetailPage} />
          <Route path="/mail/:aliasId/email/:uid" component={MailActivityPage} />
        </Switch>
        {AgentFeedback && <AgentFeedback />}
      </Suspense>
    </Provider>
  );
}

export default App;
