import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import { render } from 'preact';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
