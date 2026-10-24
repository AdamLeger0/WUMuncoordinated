import * as React from 'react';

// This import loads the firebase namespace along with all its type information.
import firebase from 'firebase/compat/app';

// These imports load individual services into the firebase namespace.
import 'firebase/compat/auth';
import 'firebase/compat/database';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import 'firebase/compat/analytics';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

import { Route, Switch } from 'react-router-dom';
import './App.css';

import Onboard from './pages/Onboard';
import Homepage from './pages/Homepage';
import Committee from './pages/Committee';
import CommitteesDirectory from './pages/CommitteesDirectory';
import ConferenceAdmin from './pages/ConferenceAdmin';
import { NotFound } from './components/NotFound';
import { installDatabaseSync } from './modules/db-sync';

const firebaseConfig = {
  apiKey: "AIzaSyDZ3DShdIqbDfJGM-TbGMjwFIdOmUwO3a4",
  authDomain: "wumun-hub.firebaseapp.com",
  databaseURL: "https://wumun-hub-default-rtdb.firebaseio.com",
  projectId: "wumun-hub",
  storageBucket: "wumun-hub.firebasestorage.app",
  messagingSenderId: "288208820242",
  appId: "1:288208820242:web:c149cdacd583ef319620cb"
};

const useFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const emulatorState = window as typeof window & {
  __FIREBASE_EMULATORS_CONNECTED__?: boolean;
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

if (useFirebaseEmulators && !emulatorState.__FIREBASE_EMULATORS_CONNECTED__) {
  firebase.auth().useEmulator('http://127.0.0.1:9099');
  connectDatabaseEmulator(getDatabase(), '127.0.0.1', 9000);
  connectStorageEmulator(getStorage(), '127.0.0.1', 9199);
  emulatorState.__FIREBASE_EMULATORS_CONNECTED__ = true;
}

installDatabaseSync();

class App extends React.Component {
  render() {
    return (
      <Switch>
        <Route exact path="/" component={Homepage} />
        <Route exact path="/onboard" component={Onboard} />
        <Route exact path="/committees" component={CommitteesDirectory} />
        <Route exact path="/admin" component={ConferenceAdmin} />
        <Route path="/committees/:committeeID" component={Committee} />
        <Route path="*">
          <NotFound item="page" id="unknown" />
        </Route>
      </Switch>
    );
  }
}

export default App;
