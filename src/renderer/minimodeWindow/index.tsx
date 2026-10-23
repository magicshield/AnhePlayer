import '@infra/tauriBridge/autoInject';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import bootstrapAuxiliaryWindow from '../bootstrap/auxiliaryWindow';
import App from './App';

document.body.dataset.window = 'minimode';

const container = document.getElementById('root')!;
const root = createRoot(container);

bootstrapAuxiliaryWindow()
    .then(() => {
        root.render(
            <StrictMode>
                <App />
            </StrictMode>,
        );
    })
    .catch((err) => {
        console.error('[MinimodeWindow Bootstrap Failed]', err);
    });
