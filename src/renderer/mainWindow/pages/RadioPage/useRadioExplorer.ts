import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestStatus } from '@common/constant';
import type { IRadioBrowserMusicItem } from '@common/radioBrowser';
import {
    getExploreStations,
    getFacets,
    searchStations,
    type IRadioBrowserFacets,
    type IRadioStationFilters,
} from '@infra/radioBrowser/renderer';

const EMPTY_FACETS: IRadioBrowserFacets = { countries: [], languages: [], tags: [] };

export function useRadioExplorer(filters: IRadioStationFilters) {
    const [stations, setStations] = useState<IRadioBrowserMusicItem[]>([]);
    const [facets, setFacets] = useState<IRadioBrowserFacets>(EMPTY_FACETS);
    const [status, setStatus] = useState<RequestStatus>(RequestStatus.Idle);
    const [facetsStatus, setFacetsStatus] = useState<RequestStatus>(RequestStatus.Idle);
    const generationRef = useRef(0);
    const filtersRef = useRef(filters);
    filtersRef.current = filters;
    const filterKey = JSON.stringify(filters);

    const loadStations = useCallback(async (forceGeneration?: number) => {
        const generation = forceGeneration ?? ++generationRef.current;
        setStatus(RequestStatus.Pending);
        try {
            const targetCount = window.innerWidth < 1100 || window.innerHeight < 680 ? 800 : 1200;
            const result = await getExploreStations(filtersRef.current, targetCount);
            if (generation !== generationRef.current) return;
            setStations(result.data);
            setStatus(RequestStatus.Done);
        } catch {
            if (generation !== generationRef.current) return;
            setStatus(RequestStatus.Error);
        }
    }, []);

    useEffect(() => {
        const generation = ++generationRef.current;
        loadStations(generation);
    }, [filterKey, loadStations]);

    const loadFacets = useCallback(async (force = false) => {
        setFacetsStatus(RequestStatus.Pending);
        try {
            const result = await getFacets(force);
            setFacets(result);
            setFacetsStatus(result.partial ? RequestStatus.Error : RequestStatus.Done);
        } catch {
            setFacetsStatus(RequestStatus.Error);
        }
    }, []);

    useEffect(() => {
        loadFacets();
    }, [loadFacets]);

    return {
        stations,
        facets,
        status,
        facetsStatus,
        retry: () => loadStations(),
        retryFacets: () => loadFacets(true),
    };
}

export function useRadioSearch(query: string, enabled: boolean) {
    const [results, setResults] = useState<IRadioBrowserMusicItem[]>([]);
    const [status, setStatus] = useState<RequestStatus>(RequestStatus.Idle);
    const generationRef = useRef(0);

    useEffect(() => {
        const normalized = query.trim();
        if (!enabled || normalized.length === 0) {
            generationRef.current++;
            setResults([]);
            setStatus(RequestStatus.Idle);
            return;
        }

        const generation = ++generationRef.current;
        const timer = setTimeout(async () => {
            setStatus(RequestStatus.Pending);
            try {
                const response = await searchStations({ query: normalized }, 0, 10);
                if (generation !== generationRef.current) return;
                setResults(response.data.slice(0, 10));
                setStatus(RequestStatus.Done);
            } catch {
                if (generation !== generationRef.current) return;
                setStatus(RequestStatus.Error);
            }
        }, 260);

        return () => clearTimeout(timer);
    }, [enabled, query]);

    return { results, status };
}
