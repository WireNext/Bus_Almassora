// Dades GTFS
const gtfsData = {
    autobusosalmassora: {}
};

// Icona personalitzada per a les parades (cercles)
const customStopIcon = L.divIcon({
    className: 'custom-stop-icon',
    html: '<div style="background-color: #007bff; border-radius: 50%; width: 12px; height: 12px; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

// Variables globals
const preprocessedData = {
    autobusosalmassora: {}
};
let stopClusterGroup = null;

// Carregar i processar els fitxers GTFS
async function loadGTFSData(agency) {
    const dataDir = `./data/${agency}/`;
    const files = ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'shapes.txt'];

    for (const file of files) {
        try {
            const response = await fetch(dataDir + file);
            if (!response.ok) throw new Error(`Error carregant ${file}`);
            const text = await response.text();

            const lines = text.split('\n').filter(line => line.trim() !== '');
            if (lines.length <= 1) continue;

            const headers = lines[0].split(',');
            const data = lines.slice(1).map(line => {
                const values = line.split(',');
                return headers.reduce((obj, header, i) => {
                    obj[header.trim()] = values[i] ? values[i].trim() : '';
                    return obj;
                }, {});
            });

            gtfsData[agency][file.replace('.txt', '')] = data;

        } catch (error) {
            console.error(`No s’ha pogut carregar ${file} per a ${agency}:`, error);
        }
    }
}

// Preprocessar dades per millorar rendiment
function preprocessGTFSData(agency) {
    const data = gtfsData[agency];

    const tripsByRoute = data.trips.reduce((acc, trip) => {
        if (!acc[trip.route_id]) acc[trip.route_id] = [];
        acc[trip.route_id].push(trip);
        return acc;
    }, {});

    const routesById = data.routes.reduce((acc, route) => {
        acc[route.route_id] = route;
        return acc;
    }, {});

    const stopTimesByStop = data.stop_times.reduce((acc, st) => {
        if (!st.departure_time) return acc;

        const trip = data.trips.find(t => t.trip_id === st.trip_id);
        if (!trip) return acc;

        const route = routesById[trip.route_id];
        if (!route) return acc;

        if (!acc[st.stop_id]) acc[st.stop_id] = [];

        acc[st.stop_id].push({
            hora: st.departure_time,
            linia: route.route_short_name || '',
            nom: route.route_long_name || ''
        });

        return acc;
    }, {});

    preprocessedData[agency] = { routesById, tripsByRoute, stopTimesByStop };
}

// Inicialitzar mapa
function initMap() {
    const map = L.map('map').setView([39.95, -0.07], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    stopClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 80,
        disableClusteringAtZoom: 16
    });

    map.addLayer(stopClusterGroup);
    return map;
}

// Dibuixar parades amb cercles
function drawStopsOnMap(map, agency) {
    const stops = gtfsData[agency].stops || [];
    const stopTimesIndexed = preprocessedData[agency].stopTimesByStop;

    stops.forEach(stop => {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (isNaN(lat) || isNaN(lon)) return;

        // 🟢 Ací usem el customStopIcon definit a dalt
        const marker = L.marker([lat, lon], { icon: customStopIcon });
        marker.bindPopup("Carregant...");

        marker.on('click', () => {
            const ara = new Date();

            function horaAData(horaStr) {
                const [hh, mm, ss] = horaStr.split(':').map(Number);
                const d = new Date(ara);
                d.setHours(hh, mm, ss || 0, 0);
                return d;
            }

            const horaris = stopTimesIndexed[stop.stop_id] || [];
            const horarisAmbDiff = horaris.map(h => {
                const horaSortida = horaAData(h.hora);
                let diffMin = (horaSortida - ara) / 60000;
                if (diffMin < 0) diffMin += 24 * 60;
                return { ...h, diffMin, horaSortida };
            }).sort((a, b) => a.diffMin - b.diffMin);

            const futurs = horarisAmbDiff.filter(h => h.diffMin >= 0);
            if (futurs.length === 0) {
                marker.setPopupContent(`<strong>${stop.stop_name}</strong><br>No hi ha més serveis hui.`);
                return;
            }

            const propers = futurs.slice(0, 3);
            let html = `<strong>${stop.stop_name}</strong><br><ul>`;

            propers.forEach(h => {
                if (h.diffMin <= 1) {
                    html += `<li><b>${h.linia}</b> → ${h.nom}: <span class="parpadeig" style="color:red;">en breu</span></li>`;
                } else {
                    html += `<li><b>${h.linia}</b> → ${h.nom}: en ${Math.round(h.diffMin)} min</li>`;
                }
            });

            html += '</ul>';
            marker.setPopupContent(html);
        });

        stopClusterGroup.addLayer(marker);
    });
}

// Dibuixar línies
function drawRoutes(map, agency) {
    const routes = gtfsData[agency].routes || [];
    const trips = gtfsData[agency].trips || [];
    const shapes = gtfsData[agency].shapes || [];

    if (routes.length === 0 || trips.length === 0 || shapes.length === 0) return;

    const shapeMap = new Map();
    shapes.forEach(shape => {
        const id = shape.shape_id?.trim();
        if (!shapeMap.has(id)) shapeMap.set(id, []);
        shapeMap.get(id).push([
            parseFloat(shape.shape_pt_lat),
            parseFloat(shape.shape_pt_lon)
        ]);
    });

    routes.forEach(route => {
        const color = `#${route.route_color || '007bff'}`;
        const trip = trips.find(t => t.route_id === route.route_id && t.shape_id);
        if (!trip) return;

        const punts = shapeMap.get(trip.shape_id);
        if (!punts) return;

        L.polyline(punts, { color, weight: 4, opacity: 0.8 })
            .addTo(map)
            .bindPopup(`Línia ${route.route_short_name}: ${route.route_long_name}`);
    });
}

// Iniciar aplicació (sense llistat de línies)
async function startApp() {
    await loadGTFSData('autobusosalmassora');
    preprocessGTFSData('autobusosalmassora');

    const map = initMap();
    drawStopsOnMap(map, 'autobusosalmassora');
    drawRoutes(map, 'autobusosalmassora');
}

startApp();
