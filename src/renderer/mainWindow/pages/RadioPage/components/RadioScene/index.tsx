import {
    forwardRef,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    type HTMLAttributes,
} from 'react';
import { cn } from '@common/cn';
import type { IRadioSceneNode, RadioGenreFamily, RadioSceneLayout } from '../../data/sceneLayout';
import { RadioSceneEngine, type IRadioSceneEngineCallbacks } from './RadioSceneEngine';

export interface IRadioSceneHandle {
    focusNode(key: string, smooth?: boolean): void;
    focusGenreFamily(family: RadioGenreFamily, smooth?: boolean): void;
    highlightGenreFamily(family: RadioGenreFamily | null): void;
    getCenterKey(): string | null;
    updateTheme(): void;
}

interface RadioSceneProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
    nodes: IRadioSceneNode[];
    layout: RadioSceneLayout;
    selectedKey: string | null;
    playingKey: string | null;
    isLivePlaying?: boolean;
    onHover: (key: string | null) => void;
    onSelect: (key: string) => void;
    onInteractionStart: () => void;
    onInteractionEnd: (centerKey: string | null) => void;
    onContextLost: () => void;
    onContextRestored: () => void;
}

const RadioScene = forwardRef<IRadioSceneHandle, RadioSceneProps>(function RadioScene(
    {
        nodes,
        layout,
        selectedKey,
        playingKey,
        isLivePlaying = false,
        onHover,
        onSelect,
        onInteractionStart,
        onInteractionEnd,
        onContextLost,
        onContextRestored,
        className,
        ...rest
    },
    ref,
) {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<RadioSceneEngine | null>(null);
    const callbacksRef = useRef<IRadioSceneEngineCallbacks>({
        onHover,
        onSelect,
        onInteractionStart,
        onInteractionEnd,
        onContextLost,
        onContextRestored,
    });
    callbacksRef.current = {
        onHover,
        onSelect,
        onInteractionStart,
        onInteractionEnd,
        onContextLost,
        onContextRestored,
    };

    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const callbacks: IRadioSceneEngineCallbacks = {
            onHover: (key) => callbacksRef.current.onHover(key),
            onSelect: (key) => callbacksRef.current.onSelect(key),
            onInteractionStart: () => callbacksRef.current.onInteractionStart(),
            onInteractionEnd: (key) => callbacksRef.current.onInteractionEnd(key),
            onContextLost: () => callbacksRef.current.onContextLost(),
            onContextRestored: () => callbacksRef.current.onContextRestored(),
        };
        let engine: RadioSceneEngine;
        try {
            engine = new RadioSceneEngine(containerRef.current, callbacks);
        } catch {
            callbacks.onContextLost();
            return;
        }
        engineRef.current = engine;
        return () => {
            engineRef.current = null;
            engine.dispose();
        };
    }, []);

    useLayoutEffect(() => {
        engineRef.current?.setNodes(nodes);
    }, [nodes]);

    useLayoutEffect(() => {
        engineRef.current?.setLayout(layout);
    }, [layout]);

    useLayoutEffect(() => {
        engineRef.current?.setSelected(selectedKey);
    }, [selectedKey]);

    useLayoutEffect(() => {
        engineRef.current?.setPlaying(playingKey);
    }, [playingKey]);

    useLayoutEffect(() => {
        engineRef.current?.setLivePlaying(isLivePlaying);
    }, [isLivePlaying]);

    useImperativeHandle(
        ref,
        () => ({
            focusNode: (key, smooth) => engineRef.current?.focusNode(key, smooth),
            focusGenreFamily: (family, smooth) =>
                engineRef.current?.focusGenreFamily(family, smooth),
            highlightGenreFamily: (family) => engineRef.current?.highlightGenreFamily(family),
            getCenterKey: () => engineRef.current?.getCenterKey() ?? null,
            updateTheme: () => engineRef.current?.updateTheme(),
        }),
        [],
    );

    return <div ref={containerRef} className={cn('radio-scene', className)} {...rest} />;
});

export default RadioScene;
