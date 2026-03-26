import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
import MailListPage from "./pages/mail-list";
import MailDetailPage from "./pages/mail-detail";
import MailActivityPage from "./pages/mail-activity";
import "./styles.css";

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/" component={MailListPage} />
        <Route path="/mail/:aliasId" component={MailDetailPage} />
        <Route path="/mail/:aliasId/activity/:actIdx" component={MailActivityPage} />
      </Switch>
      {import.meta.env.DEV && <AgentFeedback />}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
