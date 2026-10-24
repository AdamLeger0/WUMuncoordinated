import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Router } from 'react-router-dom';
import App from './App';
import * as serviceWorker from './serviceWorker';
import createHistory from 'history/createBrowserHistory';
import 'semantic-ui-css/semantic.min.css';
import './index.css';

export const appHistory = createHistory();

ReactDOM.render(
  // @ts-ignore
  <Router history={appHistory}>
    <App />
  </Router>,
  document.getElementById('root') as HTMLElement
);

serviceWorker.unregister();
