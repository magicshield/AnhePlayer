import { Vector3 } from 'three';
import { compositeKey } from '@common/mediaKey';
import type { IRadioBrowserMusicItem } from '@common/radioBrowser';

export type RadioSceneLayout = 'globe' | 'genres';
export type RadioGeoSource = 'exact' | 'country' | 'estimated';

export type RadioGenreFamily =
    | '综合'
    | '流行'
    | '新闻谈话'
    | '摇滚'
    | '电子'
    | '地方与世界'
    | '宗教'
    | '古典'
    | '爵士蓝调'
    | '乡村民谣'
    | '嘻哈';

export interface IRadioSceneNode {
    key: string;
    station: IRadioBrowserMusicItem;
    globePosition: Vector3;
    genrePosition: Vector3;
    geoSource: RadioGeoSource;
    genreFamily: RadioGenreFamily;
    primaryTag: string;
    popularity: number;
}

export const RADIO_GENRE_FAMILIES: RadioGenreFamily[] = [
    '综合',
    '流行',
    '新闻谈话',
    '摇滚',
    '电子',
    '地方与世界',
    '宗教',
    '古典',
    '爵士蓝调',
    '乡村民谣',
    '嘻哈',
];

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
    AR: [-34, -64],
    AT: [47.5, 14.5],
    AU: [-25, 134],
    BE: [50.5, 4.5],
    BR: [-10, -55],
    CA: [56, -106],
    CH: [47, 8],
    CL: [-33, -71],
    CN: [35, 105],
    CO: [4, -72],
    CZ: [49.8, 15.5],
    DE: [51, 10],
    DK: [56, 10],
    EG: [27, 30],
    ES: [40, -4],
    FI: [64, 26],
    FR: [46, 2],
    GB: [55, -3],
    GR: [39, 22],
    HU: [47, 20],
    ID: [-2, 118],
    IE: [53, -8],
    IL: [31.5, 34.8],
    IN: [21, 79],
    IT: [42.5, 12.5],
    JP: [36, 138],
    KR: [36, 128],
    MX: [23, -102],
    MY: [4, 102],
    NL: [52.2, 5.3],
    NO: [62, 10],
    NZ: [-41, 174],
    PH: [13, 122],
    PL: [52, 19],
    PT: [39.5, -8],
    RO: [46, 25],
    RS: [44, 21],
    RU: [60, 90],
    SE: [62, 15],
    SG: [1.35, 103.8],
    TH: [15, 101],
    TR: [39, 35],
    TW: [23.7, 121],
    UA: [49, 32],
    US: [39, -98],
    VN: [16, 108],
    ZA: [-29, 24],
};

const GENRE_ANCHORS: Record<RadioGenreFamily, [number, number, number]> = {
    综合: [-0.5, 0.1, 0],
    流行: [-2.4, 1.6, 0.2],
    新闻谈话: [2.6, 1.7, -0.2],
    摇滚: [-3.1, 0.2, -0.5],
    电子: [0.2, 2.4, 0.8],
    地方与世界: [0.1, -2.3, 0.3],
    宗教: [-2.8, -1.9, -0.8],
    古典: [2.5, 0.5, 0.6],
    爵士蓝调: [1.2, 1.2, -1],
    乡村民谣: [2.7, -2, 0.2],
    嘻哈: [1, -1.1, 1.2],
};

export function getRadioGenreAnchor(family: RadioGenreFamily): Vector3 {
    return new Vector3(...GENRE_ANCHORS[family]);
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function seededUnit(seed: number, salt: number): number {
    let value = seed ^ Math.imul(salt, 0x9e3779b1);
    value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function toSpherePosition(latitude: number, longitude: number, radius = 4.04): Vector3 {
    const phi = (latitude * Math.PI) / 180;
    const lambda = (longitude * Math.PI) / 180;
    return new Vector3(
        radius * Math.cos(phi) * Math.sin(lambda),
        radius * Math.sin(phi),
        radius * Math.cos(phi) * Math.cos(lambda),
    );
}

export function classifyRadioGenre(tags: string[]): RadioGenreFamily {
    const text = tags.join(' ').toLowerCase();
    if (/news|talk|speech|sports|podcast|资讯|新闻|谈话|体育/.test(text)) return '新闻谈话';
    if (/rock|metal|punk|alternative|摇滚|金属/.test(text)) return '摇滚';
    if (/electro|dance|house|techno|trance|edm|电子|舞曲/.test(text)) return '电子';
    if (/jazz|blues|soul|funk|爵士|蓝调/.test(text)) return '爵士蓝调';
    if (/classical|opera|symphony|古典|歌剧/.test(text)) return '古典';
    if (/hip.?hop|rap|r&b|嘻哈|说唱/.test(text)) return '嘻哈';
    if (/country|folk|americana|乡村|民谣/.test(text)) return '乡村民谣';
    if (/relig|christ|gospel|islam|宗教|福音/.test(text)) return '宗教';
    if (/world|local|regional|latin|afric|asia|民族|地方|世界/.test(text)) return '地方与世界';
    if (/pop|hits|top 40|流行/.test(text)) return '流行';
    return '综合';
}

function resolveCoordinates(station: IRadioBrowserMusicItem): {
    latitude: number;
    longitude: number;
    source: RadioGeoSource;
} {
    const metadata = station.radioBrowser;
    if (metadata.geoLat != null && metadata.geoLong != null) {
        return { latitude: metadata.geoLat, longitude: metadata.geoLong, source: 'exact' };
    }

    const seed = hashString(station.id);
    const centroid = COUNTRY_CENTROIDS[metadata.countryCode];
    if (centroid) {
        return {
            latitude: Math.max(-88, Math.min(88, centroid[0] + (seededUnit(seed, 1) - 0.5) * 5)),
            longitude: centroid[1] + (seededUnit(seed, 2) - 0.5) * 7,
            source: 'country',
        };
    }

    return {
        latitude: (seededUnit(seed, 3) - 0.5) * 150,
        longitude: (seededUnit(seed, 4) - 0.5) * 360,
        source: 'estimated',
    };
}

function createGenrePosition(station: IRadioBrowserMusicItem, family: RadioGenreFamily): Vector3 {
    const seed = hashString(station.id);
    const anchor = GENRE_ANCHORS[family];
    const spread = family === '综合' ? 1.7 : 1.1;
    return new Vector3(
        anchor[0] + (seededUnit(seed, 5) - 0.5) * spread,
        anchor[1] + (seededUnit(seed, 6) - 0.5) * spread,
        anchor[2] + (seededUnit(seed, 7) - 0.5) * spread,
    );
}

export function buildRadioSceneNodes(stations: IRadioBrowserMusicItem[]): IRadioSceneNode[] {
    return stations.map((station) => {
        const coordinates = resolveCoordinates(station);
        const genreFamily = classifyRadioGenre(station.radioBrowser.tags);
        return {
            key: compositeKey(station.platform, station.id),
            station,
            globePosition: toSpherePosition(coordinates.latitude, coordinates.longitude),
            genrePosition: createGenrePosition(station, genreFamily),
            geoSource: coordinates.source,
            genreFamily,
            primaryTag: station.radioBrowser.tags[0] || genreFamily,
            popularity: Math.min(
                1,
                Math.log1p(station.radioBrowser.clickCount) / Math.log(100_001),
            ),
        };
    });
}
