import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
import HomePage from "./pages/home";
import PricePage from "./pages/price";
import MyAccountPage from "./pages/my-account";
import ManagePage from "./pages/manage";
import WritePage from "./pages/write";
import BottomNav from "./components/bottom-nav";
import "./styles.css";

function App() {
  return (
    <Provider>
      <div style={{ paddingBottom: 72 }}>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/price/:category?" component={PricePage} />
          <Route path="/manage" component={ManagePage} />
          <Route path="/write" component={WritePage} />
          <Route path="/my" component={MyAccountPage} />
        </Switch>
      </div>
      <BottomNav />
      {import.meta.env.DEV && <AgentFeedback />}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
