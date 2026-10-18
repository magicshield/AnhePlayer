import '@infra/tauriBridge/autoInject';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import bootstrapAuxiliaryWindow from '../bootstrap/auxiliaryWindow';
import App from './App';
import { initTauriBridges } from '@infra/tauriBridge';

document.body.dataset.window = 'minimode';

const container = document.getElementById('root')!;
const root = createRoot(container);

initTauriBridges()
    .then(() => bootstrapAuxiliaryWindow())
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
