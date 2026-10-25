import React from 'react';
import { createRoot } from 'react-dom/client';
import { Timeline } from '../src/Timeline';
import { Markdown } from '../src/RichContent';
Object.assign(window, { testReact: { React, createRoot, Timeline, Markdown } });
