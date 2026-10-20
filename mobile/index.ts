import { registerRootComponent } from 'expo';
import './src/background'; // defines the background location task before anything else
import App from './App';
registerRootComponent(App);
