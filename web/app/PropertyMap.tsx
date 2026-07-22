"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import type { PropertyRecord } from "../lib/property-model";

type Leaflet = typeof import("leaflet");

type Props = {
  properties: PropertyRecord[];
  onOpenProperty: (property: PropertyRecord) => void;
  onProspect: (latitude: number, longitude: number) => void;
  center?: [number, number];
};

const STATUS_COLORS: Record<string, string> = {
  urgent: "#ef796c",
  inherited: "#aa93d2",
  violation: "#f3a85f",
  warm: "#5aa469",
  absentee: "#8fc4d8",
  expired: "#7c8a82",
  review: "#7c8a82",
};

// Real slippy map: OpenStreetMap raster tiles via Leaflet. Clicking anywhere on
// the map prospects that area for new leads.
export default function PropertyMap({ properties, onOpenProperty, onProspect, center }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<Leaflet | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);
  // Flips once Leaflet has finished loading, so the marker effect below re-runs
  // even if the property list arrived before the map was ready.
  const [mapReady, setMapReady] = useState(false);
  // Keep the latest callbacks without re-initialising the map.
  const handlersRef = useRef({ onOpenProperty, onProspect });
  useEffect(() => {
    handlersRef.current = { onOpenProperty, onProspect };
  }, [onOpenProperty, onProspect]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const imported = await import("leaflet");
      const L = ((imported as unknown as { default?: Leaflet }).default ?? imported) as Leaflet;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: center ?? [40.7128, -73.87],
        zoom: 12,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      map.on("click", (event) => {
        handlersRef.current.onProspect(event.latlng.lat, event.latlng.lng);
      });

      leafletRef.current = L;
      mapRef.current = map;
      markersRef.current = L.layerGroup().addTo(map);
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      setMapReady(false);
    };
    // Intentionally initialise once; markers update in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render markers whenever the property set changes.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = markersRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();
    const located = properties.filter(
      (property) => typeof property.latitude === "number" && typeof property.longitude === "number",
    );

    for (const property of located) {
      const color = STATUS_COLORS[property.status] ?? "#143f33";
      const icon = L.divIcon({
        className: "map-marker",
        html: `<span style="background:${color}">${property.score}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marker = L.marker([property.latitude as number, property.longitude as number], { icon });
      marker.bindTooltip(`${property.address} — ${property.ownerName}`, { direction: "top" });
      marker.on("click", () => handlersRef.current.onOpenProperty(property));
      marker.addTo(layer);
    }

    if (located.length > 0) {
      const bounds = L.latLngBounds(
        located.map((property) => [property.latitude as number, property.longitude as number] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    }
  }, [properties, mapReady]);

  return <div ref={containerRef} className="leaflet-canvas" aria-label="Property map" />;
}
