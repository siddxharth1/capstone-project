import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { loadModules } from "esri-loader";
import "./App.css";

// Separate the coordinate display into a memoized component
const CoordinatePanel = memo(({ coordinates, ndviValue }) => (
  <div className="coordinate-panel">
    {coordinates.latitude ? (
      <>
        <p>Coordinates:</p>
        <p>Latitude: {coordinates.latitude.toFixed(6)}</p>
        <p>Longitude: {coordinates.longitude.toFixed(6)}</p>
        {ndviValue && <p className="ndvi-value">{ndviValue.assessment}</p>}
        {ndviValue && (
          <p className="ndvi-value">NDVI: {ndviValue.averageNDVI}</p>
        )}
      </>
    ) : (
      <p>Click on the map to get coordinates</p>
    )}
  </div>
));

// Separate NDVI visualization into a memoized component
const NDVIPanel = memo(({ ndviImage }) => (
  <div className="ndvi-panel">
    <div className="ndvi-header">NDVI Visualization</div>
    <img src={ndviImage} alt="NDVI visualization" loading="lazy" />
  </div>
));

function App() {
  const viewDivRef = useRef(null);
  const coordinateDivRef = useRef(null);
  const miniMapDivRef = useRef(null);
  const ndviDivRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const viewInstanceRef = useRef(null);
  const miniViewInstanceRef = useRef(null);
  const satelliteTracksRef = useRef(null);
  const locationContainerRef = useRef(null);

  const [query, setQuery] = useState("");
  // const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);

  const [ndviValue, setNdviValue] = useState(null);
  const [ndviImage, setNdviImage] = useState(null);
  const [locations, setLocations] = useState([]);
  const [coordinates, setCoordinates] = useState({
    latitude: null,
    longitude: null,
  });

  const [isInputFocused, setIsInputFocused] = useState(false);

  const fetchLocation = async () => {
    if (!query.trim()) return;
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}`
      );
      const data = await response.json();
      if (data.length > 0) {
        setLocations(data);
        setError(null);
      } else {
        setError("Location not found");
        setLocations([]);
      }
    } catch (err) {
      console.log(err);
      setError("Error fetching location");
    }
  };

  // Memoize the upload function
  const captureMiniMapAndUpload = useCallback(async (miniView) => {
    if (!miniView?.ready) {
      console.log("Mini map not ready yet, waiting...");
      return;
    }

    try {
      await miniView.goTo(miniView.center);

      const screenshot = await miniView.takeScreenshot({
        format: "png",
        quality: 100,
        width: 200,
        height: 200,
      });

      const blob = await fetch(screenshot.dataUrl).then((res) => res.blob());
      const formData = new FormData();
      formData.append("image", blob, "minimap.png");

      const response = await fetch("http://localhost:3000/upload", {
        method: "POST",
        body: formData,
        mode: "cors",
      });

      if (!response.ok) {
        throw new Error("Failed to upload mini map image");
      }

      const data = await response.json();
      if (data?.ndvi) {
        setNdviValue(data.ndvi);
        if (data.ndviImage) {
          setNdviImage(`http://localhost:3000/uploads/${data.ndviImage}`);
        }
      }
    } catch (error) {
      console.error("Error in capture and upload process:", error);
    }
  }, []);

  // Memoize the click handler
  const handleMapClick = useCallback(
    async (event, view, satelliteTracks, miniView, Graphic) => {
      event.stopPropagation();

      const response = await view.hitTest(event);
      satelliteTracks.removeAll();

      const mapPoint = response.results.length
        ? response.results[0].mapPoint
        : event.mapPoint;

      if (!mapPoint) return;

      const { latitude, longitude } = mapPoint;
      setCoordinates({ latitude, longitude });

      const pinpoint = new Graphic({
        geometry: {
          type: "point",
          longitude,
          latitude,
        },
        symbol: {
          type: "simple-marker",
          style: "circle",
          color: "red",
          size: "12px",
          outline: {
            color: "white",
            width: 2,
          },
        },
      });

      const textGraphic = new Graphic({
        geometry: {
          type: "point",
          longitude,
          latitude: latitude + 1,
        },
        symbol: {
          type: "text",
          color: "black",
          haloColor: "white",
          haloSize: "1px",
          text: `Lat: ${latitude.toFixed(6)}\nLon: ${longitude.toFixed(6)}`,
          font: {
            size: 12,
            family: "Arial",
          },
        },
      });

      satelliteTracks.addMany([pinpoint, textGraphic]);
      miniView.center = [longitude, latitude];

      setTimeout(() => {
        captureMiniMapAndUpload(miniView);
      }, 1500);
    },
    [captureMiniMapAndUpload]
  );

  useEffect(() => {
    let cleanup = () => {};

    loadModules([
      "esri/Map",
      "esri/views/SceneView",
      "esri/layers/GraphicsLayer",
      "esri/Graphic",
      "esri/views/MapView",
    ])
      .then(([Map, SceneView, GraphicsLayer, Graphic, MapView]) => {
        const map = new Map({
          basemap: "satellite",
        });

        const view = new SceneView({
          container: viewDivRef.current,
          map,
          constraints: {
            altitude: {
              max: 12000000000,
            },
          },
        });

        const satelliteTracks = new GraphicsLayer();
        map.add(satelliteTracks);

        const miniMap = new Map({
          basemap: "satellite",
        });

        const miniView = new MapView({
          container: miniMapDivRef.current,
          map: miniMap,
          zoom: 18,
          ui: {
            components: [],
          },
          constraints: {
            minZoom: 18,
            maxZoom: 18,
            snapToZoom: false,
            rotationEnabled: false,
          },
        });

        // Store instances in refs
        mapInstanceRef.current = map;
        viewInstanceRef.current = view;
        miniViewInstanceRef.current = miniView;
        satelliteTracksRef.current = satelliteTracks;

        // Add click event listener
        const clickHandler = (event) =>
          handleMapClick(event, view, satelliteTracks, miniView, Graphic);
        view.on("click", clickHandler);

        cleanup = () => {
          view?.destroy();
          miniView?.destroy();
          mapInstanceRef.current = null;
          viewInstanceRef.current = null;
          miniViewInstanceRef.current = null;
          satelliteTracksRef.current = null;
        };
      })
      .catch((err) => console.error("Error loading ArcGIS modules:", err));

    return cleanup;
  }, [handleMapClick]);

  // Modify the selectLocation function to handle map navigation and pinpointing
  const selectLocation = useCallback(
    (location) => {
      const view = viewInstanceRef.current;
      const miniView = miniViewInstanceRef.current;
      const satelliteTracks = satelliteTracksRef.current;

      if (!view || !miniView || !satelliteTracks) return;

      // Load the Graphic module dynamically since we're outside the main effect
      loadModules(["esri/Graphic"]).then(([Graphic]) => {
        // Clear existing graphics
        satelliteTracks.removeAll();

        const latitude = parseFloat(location.lat);
        const longitude = parseFloat(location.lon);

        // Create a point for the location
        const pinpoint = new Graphic({
          geometry: {
            type: "point",
            longitude,
            latitude,
          },
          symbol: {
            type: "simple-marker",
            style: "circle",
            color: "red",
            size: "12px",
            outline: {
              color: "white",
              width: 2,
            },
          },
        });

        // Add text label
        const textGraphic = new Graphic({
          geometry: {
            type: "point",
            longitude,
            latitude: latitude + 1,
          },
          symbol: {
            type: "text",
            color: "black",
            haloColor: "white",
            haloSize: "1px",
            text: `${location.display_name}\nLat: ${latitude.toFixed(
              6
            )}\nLon: ${longitude.toFixed(6)}`,
            font: {
              size: 12,
              family: "Arial",
            },
          },
        });

        // Add graphics to the layer
        satelliteTracks.addMany([pinpoint, textGraphic]);

        // Update coordinates state
        setCoordinates({ latitude, longitude });

        // Move the main view to the location
        view.goTo({
          target: [longitude, latitude],
          zoom: 12,
        });

        // Update mini map center
        miniView.center = [longitude, latitude];

        // Capture and upload after a delay
        setTimeout(() => {
          captureMiniMapAndUpload(miniView);
        }, 1500);
      });
    },
    [captureMiniMapAndUpload]
  );

  // Add this useEffect to handle clicks outside the container
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        locationContainerRef.current &&
        !locationContainerRef.current.contains(event.target)
      ) {
        setIsInputFocused(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="app-container">
      <div className="location-container" ref={locationContainerRef}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Enter city, area, etc."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            className="location-input"
          />
          <button onClick={fetchLocation} className="location-button">
            Search
          </button>
        </div>
        {isInputFocused && locations.length > 0 && (
          <ul className="location-list">
            {locations.map((loc, index) => (
              <li
                key={index}
                onClick={() => {
                  selectLocation(loc);
                  setIsInputFocused(false);
                  setQuery("");
                }}
                className="location-item"
              >
                {loc.display_name}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="location-error">{error}</p>}
      </div>

      <div id="viewDiv" ref={viewDivRef} className="main-map"></div>
      <div id="coordinateDiv" ref={coordinateDivRef}>
        <CoordinatePanel coordinates={coordinates} ndviValue={ndviValue} />
      </div>
      <div id="miniMapDiv" ref={miniMapDivRef} className="mini-map"></div>
      {ndviImage && (
        <div id="ndviDiv" ref={ndviDivRef}>
          <NDVIPanel ndviImage={ndviImage} />
        </div>
      )}
    </div>
  );
}

export default App;
