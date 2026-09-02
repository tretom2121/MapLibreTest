import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import MapLibreGl, { Map as MapLibreMap, NavigationControl, FullscreenControl, ScaleControl, GeolocateControl, Marker, Popup, GeoJSONSource } from 'maplibre-gl';
import type { Feature, Point } from 'geojson';

export interface StyleOption {
  id: string;
  name: string;
  url: string;
  description: string;
  badge: string;
}

export interface LocationPreset {
  name: string;
  country: string;
  coords: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface ColorOption {
  name: string;
  hex: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) private mapContainer!: ElementRef<HTMLDivElement>;

  private map: MapLibreMap | null = null;
  private activeMarkers: Marker[] = [];
  private circleFeatures: Feature<Point>[] = [];
  private activeCirclePopup: Popup | null = null;

  // Presets & Styles
  public readonly stylePresets: StyleOption[] = [
    {
      id: 'openfreemap-liberty',
      name: 'Liberty (OpenFreeMap)',
      url: 'https://tiles.openfreemap.org/styles/liberty',
      description: 'Clean, highly readable vector map style with landuse and POI features.',
      badge: 'Vector 3D'
    },
    {
      id: 'openfreemap-bright',
      name: 'Bright (OpenFreeMap)',
      url: 'https://tiles.openfreemap.org/styles/bright',
      description: 'Vibrant colors ideal for urban navigation and landmark discovery.',
      badge: 'Vector'
    },
    {
      id: 'openfreemap-positron',
      name: 'Positron Dark/Light (OpenFreeMap)',
      url: 'https://tiles.openfreemap.org/styles/positron',
      description: 'Subtle light basemap perfect for data visualization overlays.',
      badge: 'Minimal'
    },
    {
      id: 'demotiles',
      name: 'Demotiles (MapLibre Official)',
      url: 'https://demotiles.maplibre.org/style.json',
      description: 'Official MapLibre vector tile reference test style.',
      badge: 'Official'
    }
  ];

  public readonly locationPresets: LocationPreset[] = [
    { name: 'Berlin', country: 'Germany', coords: [13.404954, 52.520008], zoom: 13, pitch: 45, bearing: -17.6 },
    { name: 'London', country: 'UK', coords: [-0.1276, 51.5074], zoom: 13.5, pitch: 50, bearing: 20 },
    { name: 'New York', country: 'USA', coords: [-74.006, 40.7128], zoom: 13, pitch: 55, bearing: -25 },
    { name: 'Tokyo', country: 'Japan', coords: [139.6917, 35.6895], zoom: 12.5, pitch: 40, bearing: 10 },
    { name: 'Zurich', country: 'Switzerland', coords: [8.5417, 47.3769], zoom: 13.5, pitch: 45, bearing: 0 }
  ];

  public readonly colorOptions: ColorOption[] = [
    { name: 'Rose', hex: '#f43f5e' },
    { name: 'Cyan', hex: '#06b6d4' },
    { name: 'Emerald', hex: '#10b981' },
    { name: 'Amber', hex: '#f59e0b' },
    { name: 'Purple', hex: '#a855f7' }
  ];

  // Reactive State
  public readonly activeStyleId = signal<string>('openfreemap-liberty');
  public readonly currentStyleUrl = signal<string>('https://tiles.openfreemap.org/styles/liberty');
  public readonly customInputUrl = signal<string>('');
  
  public readonly lng = signal<number>(13.404954);
  public readonly lat = signal<number>(52.520008);
  public readonly zoom = signal<number>(13);
  public readonly pitch = signal<number>(45);
  public readonly bearing = signal<number>(0);
  public readonly is3D = signal<boolean>(true);
  
  public readonly status = signal<'Loading' | 'Ready' | 'Error'>('Loading');
  public readonly statusMessage = signal<string>('Initializing MapLibre GL engine...');
  public readonly markerCount = signal<number>(0);
  public readonly circleCount = signal<number>(0);
  public readonly layerCount = signal<number>(0);

  // Interaction Mode State ('circle' = 10px Circle Layer mode, 'marker' = HTML Pin Marker mode)
  public readonly clickMode = signal<'circle' | 'marker'>('circle');
  public readonly circleColor = signal<string>('#f43f5e');

  public ngAfterViewInit(): void {
    this.initMap();
  }

  private initMap(): void {
    try {
      this.map = new MapLibreMap({
        container: this.mapContainer.nativeElement,
        style: this.currentStyleUrl(),
        center: [this.lng(), this.lat()],
        zoom: this.zoom(),
        pitch: this.pitch(),
        bearing: this.bearing()
      });

      // Controls
      this.map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
      this.map.addControl(new FullscreenControl(), 'bottom-right');
      this.map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
      this.map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'bottom-right');

      // Set initial cursor
      this.map.getCanvas().style.cursor = 'crosshair';

      // Map lifecycle listeners
      this.map.on('load', () => {
        this.status.set('Ready');
        this.statusMessage.set('Vector tiles rendered successfully.');
        this.setupCircleLayer();
        this.updateLayerCount();
      });

      this.map.on('styledata', () => {
        this.setupCircleLayer();
        this.updateLayerCount();
      });

      this.map.on('error', (e) => {
        console.error('MapLibre error:', e);
        this.status.set('Error');
        this.statusMessage.set('Failed to load tile style or source.');
      });

      this.map.on('move', () => {
        if (!this.map) return;
        const center = this.map.getCenter();
        this.lng.set(Number(center.lng.toFixed(5)));
        this.lat.set(Number(center.lat.toFixed(5)));
        this.zoom.set(Number(this.map.getZoom().toFixed(2)));
        this.pitch.set(Math.round(this.map.getPitch()));
        this.bearing.set(Math.round(this.map.getBearing()));
        this.is3D.set(this.map.getPitch() > 10);
      });

      // Mouse hover effects on circle features
      this.map.on('mouseenter', 'circles-layer', () => {
        if (this.map) this.map.getCanvas().style.cursor = 'pointer';
      });

      this.map.on('mouseleave', 'circles-layer', () => {
        if (this.map) {
          this.map.getCanvas().style.cursor = this.clickMode() === 'circle' ? 'crosshair' : '';
        }
      });

      // Click event handler for map
      this.map.on('click', (e) => {
        if (!this.map) return;

        // Check if existing circle feature was clicked
        const bbox: [MapLibreGl.PointLike, MapLibreGl.PointLike] = [
          [e.point.x - 5, e.point.y - 5],
          [e.point.x + 5, e.point.y + 5]
        ];
        const features = this.map.queryRenderedFeatures(bbox, { layers: ['circles-layer'] });

        if (features && features.length > 0) {
          const clickedFeature = features[0];
          const geom = clickedFeature.geometry as Point;
          const circleId = clickedFeature.properties?.['id'];
          if (geom && circleId) {
            this.showCirclePopup(geom.coordinates[0], geom.coordinates[1], circleId);
            return;
          }
        }

        // Action according to active mode
        if (this.clickMode() === 'circle') {
          this.addCircle(e.lngLat.lng, e.lngLat.lat);
        } else {
          this.addMarker(e.lngLat.lng, e.lngLat.lat);
        }
      });

    } catch (err) {
      console.error('Failed to initialize map:', err);
      this.status.set('Error');
      this.statusMessage.set('Map initialization error.');
    }
  }

  /**
   * Initializes or updates the vector circle source and layer in MapLibre
   */
  private setupCircleLayer(): void {
    if (!this.map || !this.map.isStyleLoaded()) return;

    // 1. Ensure GeoJSON source exists
    if (!this.map.getSource('circles-source')) {
      this.map.addSource('circles-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: this.circleFeatures
        }
      });
    } else {
      const src = this.map.getSource('circles-source') as GeoJSONSource;
      src.setData({
        type: 'FeatureCollection',
        features: this.circleFeatures
      });
    }

    // 2. Add subtle outer glow layer
    if (!this.map.getLayer('circles-glow-layer')) {
      this.map.addLayer({
        id: 'circles-glow-layer',
        type: 'circle',
        source: 'circles-source',
        paint: {
          'circle-radius': 14,
          'circle-color': this.circleColor(),
          'circle-opacity': 0.25,
          'circle-blur': 0.5
        }
      });
    } else {
      this.map.setPaintProperty('circles-glow-layer', 'circle-color', this.circleColor());
    }

    // 3. Add main circle layer with fixed 10px radius
    if (!this.map.getLayer('circles-layer')) {
      this.map.addLayer({
        id: 'circles-layer',
        type: 'circle',
        source: 'circles-source',
        paint: {
          'circle-radius': 10, // Fixed radius of 10px
          'circle-color': this.circleColor(),
          'circle-opacity': 0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.95
        }
      });
    } else {
      this.map.setPaintProperty('circles-layer', 'circle-color', this.circleColor());
    }
  }

  public setClickMode(mode: 'circle' | 'marker'): void {
    this.clickMode.set(mode);
    if (this.map) {
      this.map.getCanvas().style.cursor = mode === 'circle' ? 'crosshair' : '';
    }
  }

  public setCircleColor(colorHex: string): void {
    this.circleColor.set(colorHex);
    if (this.map) {
      if (this.map.getLayer('circles-layer')) {
        this.map.setPaintProperty('circles-layer', 'circle-color', colorHex);
      }
      if (this.map.getLayer('circles-glow-layer')) {
        this.map.setPaintProperty('circles-glow-layer', 'circle-color', colorHex);
      }
    }
  }

  public addCircle(lng: number, lat: number): void {
    if (!this.map) return;

    const newId = `circle-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newFeature: Feature<Point> = {
      type: 'Feature',
      properties: {
        id: newId,
        createdAt: new Date().toLocaleTimeString(),
        lng: lng.toFixed(5),
        lat: lat.toFixed(5)
      },
      geometry: {
        type: 'Point',
        coordinates: [lng, lat]
      }
    };

    this.circleFeatures.push(newFeature);
    this.circleCount.set(this.circleFeatures.length);
    this.updateCircleSource();
  }

  private updateCircleSource(): void {
    if (!this.map) return;
    const source = this.map.getSource('circles-source') as GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: this.circleFeatures
      });
    } else {
      this.setupCircleLayer();
    }
  }

  public deleteCircle(circleId: string): void {
    this.circleFeatures = this.circleFeatures.filter(f => f.properties?.['id'] !== circleId);
    this.circleCount.set(this.circleFeatures.length);
    this.updateCircleSource();
    if (this.activeCirclePopup) {
      this.activeCirclePopup.remove();
      this.activeCirclePopup = null;
    }
  }

  public clearCircles(): void {
    this.circleFeatures = [];
    this.circleCount.set(0);
    this.updateCircleSource();
    if (this.activeCirclePopup) {
      this.activeCirclePopup.remove();
      this.activeCirclePopup = null;
    }
  }

  private showCirclePopup(lng: number, lat: number, circleId: string): void {
    if (!this.map) return;

    if (this.activeCirclePopup) {
      this.activeCirclePopup.remove();
    }

    const popupContent = document.createElement('div');
    popupContent.style.padding = '2px';
    popupContent.innerHTML = `
      <div style="font-weight: 700; font-size: 13px; color: ${this.circleColor()}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${this.circleColor()}; border:1.5px solid #fff; box-shadow:0 0 6px ${this.circleColor()};"></span>
        Fixed 10px Circle
      </div>
      <div style="font-family: var(--font-mono); font-size: 11px; color: #cbd5e1; line-height: 1.5; background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.1);">
        <div><strong>Lat:</strong> ${lat.toFixed(5)}</div>
        <div><strong>Lng:</strong> ${lng.toFixed(5)}</div>
        <div><strong>Radius:</strong> 10px (Screen)</div>
      </div>
      <button id="del-circle-btn" style="width: 100%; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 4px;">
        🗑️ Delete Circle
      </button>
    `;

    const btn = popupContent.querySelector('#del-circle-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        this.deleteCircle(circleId);
      });
    }

    this.activeCirclePopup = new Popup({ offset: 12, closeButton: true })
      .setLngLat([lng, lat])
      .setDOMContent(popupContent)
      .addTo(this.map);
  }

  public selectStyle(preset: StyleOption): void {
    if (this.activeStyleId() === preset.id) return;
    this.activeStyleId.set(preset.id);
    this.currentStyleUrl.set(preset.url);
    this.setStyle(preset.url);
  }

  public onCustomUrlChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.customInputUrl.set(val);
  }

  public applyCustomStyle(): void {
    const url = this.customInputUrl().trim();
    if (!url) return;
    this.activeStyleId.set('custom');
    this.currentStyleUrl.set(url);
    this.setStyle(url);
  }

  private setStyle(styleUrl: string): void {
    if (!this.map) return;
    this.status.set('Loading');
    this.statusMessage.set(`Loading vector style: ${styleUrl}...`);
    
    // Clear custom markers on style switch
    this.clearMarkers();
    
    this.map.setStyle(styleUrl);
    this.map.once('style.load', () => {
      this.status.set('Ready');
      this.statusMessage.set('Style changed successfully.');
      this.setupCircleLayer();
      this.updateLayerCount();
    });
  }

  public flyToPreset(preset: LocationPreset): void {
    if (!this.map) return;
    this.map.flyTo({
      center: preset.coords,
      zoom: preset.zoom,
      pitch: preset.pitch,
      bearing: preset.bearing,
      essential: true,
      duration: 2000
    });
  }

  public toggle3D(): void {
    if (!this.map) return;
    const currentPitch = this.map.getPitch();
    const targetPitch = currentPitch > 20 ? 0 : 55;
    this.map.easeTo({ pitch: targetPitch, duration: 800 });
  }

  public resetView(): void {
    if (!this.map) return;
    this.map.flyTo({
      center: [13.404954, 52.520008],
      zoom: 13,
      pitch: 45,
      bearing: 0,
      duration: 1200
    });
  }

  public addMarker(lng: number, lat: number): void {
    if (!this.map) return;

    const popupContent = document.createElement('div');
    popupContent.innerHTML = `
      <div style="font-weight: 600; font-size: 13px; color: #38bdf8; margin-bottom: 4px;">📍 Vector Tile Location</div>
      <div style="font-family: var(--font-mono); font-size: 12px;">
        Lat: ${lat.toFixed(5)}<br/>
        Lng: ${lng.toFixed(5)}
      </div>
      <div style="font-size: 11px; color: #94a3b8; margin-top: 6px;">Clicked point on vector map</div>
    `;

    const popup = new Popup({ offset: 25 }).setDOMContent(popupContent);

    const marker = new Marker({ color: '#38bdf8', draggable: true })
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(this.map);

    this.activeMarkers.push(marker);
    this.markerCount.set(this.activeMarkers.length);
  }

  public clearMarkers(): void {
    this.activeMarkers.forEach(m => m.remove());
    this.activeMarkers = [];
    this.markerCount.set(0);
  }

  private updateLayerCount(): void {
    if (!this.map) return;
    try {
      const style = this.map.getStyle();
      if (style && style.layers) {
        this.layerCount.set(style.layers.length);
      }
    } catch {
      // Ignore if style not fully loaded
    }
  }

  public ngOnDestroy(): void {
    this.clearMarkers();
    this.clearCircles();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
