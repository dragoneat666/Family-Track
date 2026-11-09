import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { setupBackButton } from './backButton.js';
import './styles.css';

setupBackButton();
createRoot(document.getElementById('root')).render(<App />);
