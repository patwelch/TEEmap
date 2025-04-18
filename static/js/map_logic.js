document.addEventListener('DOMContentLoaded', function() {

    // =========================================================================
    // 0. Configuration & Constants
    // =========================================================================
    const MAP_CONFIG = {
        initialCenter: [39.8283, -98.5795],
        initialZoom: 4,
        defaultArcgisStyle: { color: "#E67E22", weight: 1.5, opacity: 0.8, fillColor: "#E67E22", fillOpacity: 0.1 },
        selectedFeatureStyle: { color: "#f0e442", weight: 3, opacity: 1, fillColor: "#f0e442", fillOpacity: 0.3 },
        copiedFeatureStyle: { color: "#ff7800", weight: 3, opacity: 0.8, fillColor: "#ff7800", fillOpacity: 0.3 },
        localStorageKeyEndpoints: 'savedArcgisEndpoints',
        defaultEndpoints: [
            { name: "USA States (Sample)", url: "https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer/2" },
            { name: "World Cities (Sample)", url: "https://sampleserver6.arcgisonline.com/arcgis/rest/services/SampleWorldCities/MapServer/0" },
            { name: "Hurricanes (Sample)", url: "https://sampleserver6.arcgisonline.com/arcgis/rest/services/Hurricanes/MapServer/0"}
        ]
    };

    // =========================================================================
    // 1. DOM Element References
    // =========================================================================
    const domElements = {
        mapContainer: document.getElementById('map'),
        messageBox: document.getElementById('message-box'),
        // ArcGIS Layer Controls
        arcgisUrlInput: document.getElementById('arcgis-url-input'),
        loadArcgisButton: document.getElementById('load-arcgis-button'),
        removeArcgisButton: document.getElementById('remove-arcgis-button'), // <-- Add this
        copySelectedButton: document.getElementById('copy-selected-button'),
        addEndpointButton: document.getElementById('add-endpoint-button'),
        savedEndpointsSelect: document.getElementById('saved-endpoints-select'),
        // Filter Controls
        filterFieldSelect: document.getElementById('filter-field-select'),
        filterConditionsContainer: document.getElementById('filter-conditions-container'),
        addFilterConditionButton: document.getElementById('add-filter-condition-button'),
        filterLogicSelect: document.getElementById('filter-logic-select'),
        applyFilterButton: document.getElementById('apply-filter-button'),
        clearFilterButton: document.getElementById('clear-filter-button'),
        // Style Controls
        colorPicker: document.getElementById('color-picker'),
        applyColorButton: document.getElementById('apply-color-button'),
        // File I/O Controls
        saveButton: document.getElementById('save-button'),
        loadInput: document.getElementById('load-input')
    };

    // =========================================================================
    // 2. Application State (No changes needed here)
    // =========================================================================
    let appState = {
        map: null,
        layerControl: null,
        drawnItems: null,
        baseMaps: {},
        overlayMaps: {},
        savedEndpoints: [], // Holds { name: "...", url: "..." } objects
        isArcgisLayerLoading: false,
        selectedArcgisLayer: null, // The Leaflet layer of the *single selected feature*
        currentFilteredLayer: null, // The L.esri.featureLayer currently being filtered/styled
        currentLayerStyle: { ...MAP_CONFIG.defaultArcgisStyle }, // Holds the *current* style object for the active layer
        currentFilter: null,
        fieldDataTypes: {}, // Cache for field types of the currentFilteredLayer
        messageTimeout: null
    };

    // =========================================================================
    // 3. Utility Functions (No changes needed here)
    // =========================================================================
    function showMessage(text, duration = 3000) {
        domElements.messageBox.textContent = text;
        domElements.messageBox.style.display = 'block';
        clearTimeout(appState.messageTimeout);
        appState.messageTimeout = setTimeout(() => {
            domElements.messageBox.style.display = 'none';
        }, duration);
    }

    function getLayerNameFromUrl(url) {
        try {
            const pathParts = new URL(url).pathname.split('/');
            const serverTypeIndex = pathParts.findIndex(part => part.toLowerCase() === 'featureserver' || part.toLowerCase() === 'mapserver');
            if (serverTypeIndex > 1) {
                return pathParts[serverTypeIndex - 1] + ` (${pathParts[serverTypeIndex + 1] || 'Service'})`;
            } else {
                return pathParts[pathParts.length - 2] || "Loaded Layer";
            }
        } catch (e) {
            console.warn("Could not parse URL for fallback name:", url, e);
            return "Loaded Layer";
        }
    }

    // =========================================================================
    // 4. UI Update Functions
    // =========================================================================
    function updateFilterControlsState(enabled) {
        domElements.filterFieldSelect.disabled = !enabled;
        domElements.addFilterConditionButton.disabled = !enabled;
        domElements.filterLogicSelect.disabled = !enabled;
        // Apply/Clear buttons depend on conditions/filter state, handled separately
        if (!enabled) {
            domElements.filterFieldSelect.innerHTML = '<option value="">-- Select Field --</option>';
            domElements.filterConditionsContainer.innerHTML = '';
            domElements.applyFilterButton.disabled = true;
            domElements.clearFilterButton.disabled = true;
            appState.fieldDataTypes = {};
        }
    }

    function updateStyleControlsState(enabled) {
        domElements.colorPicker.disabled = !enabled;
        domElements.applyColorButton.disabled = !enabled;
        if (enabled && appState.currentFilteredLayer) {
             // Set color picker to current layer's base color on enable
             domElements.colorPicker.value = appState.currentLayerStyle.color || MAP_CONFIG.defaultArcgisStyle.color;
        }
    }

    function updateCopyButtonState(enabled) {
        domElements.copySelectedButton.disabled = !enabled;
    }

    // --- Add function to update the remove button state ---
    function updateRemoveButtonState(enabled) {
        domElements.removeArcgisButton.disabled = !enabled;
    }
    // --- End Add ---

    // =========================================================================
    // 5. Map Initialization & Base Layers (No changes needed here)
    // =========================================================================
    function initializeMap() {
        appState.map = L.map(domElements.mapContainer).setView(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);
        appState.drawnItems = new L.FeatureGroup();
        appState.map.addLayer(appState.drawnItems);

        // Define Basemaps
        const osmStreet = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
        const esriStreets = L.esri.basemapLayer("Streets");
        const esriImagery = L.esri.basemapLayer("Imagery");
        const esriTopographic = L.esri.basemapLayer("Topographic");
        appState.baseMaps = { "OpenStreetMap": osmStreet, "Esri Streets": esriStreets, "Esri Imagery": esriImagery, "Esri Topographic": esriTopographic };

        // Add default base layer
        osmStreet.addTo(appState.map);

        // Initialize Layer Control (will be populated later)
        appState.overlayMaps = { "Drawn & Copied Features": appState.drawnItems };
        appState.layerControl = L.control.layers(appState.baseMaps, appState.overlayMaps, { collapsed: false, position: 'topleft' }).addTo(appState.map);
        console.log("DEBUG: Map and base Layer control initialized.");
    }

    // =========================================================================
    // 6. Endpoint Management (No changes needed here)
    // =========================================================================
    const EndpointManager = {
        load: function() {
            try {
                const stored = localStorage.getItem(MAP_CONFIG.localStorageKeyEndpoints);
                if (stored) {
                    appState.savedEndpoints = JSON.parse(stored);
                    if (!Array.isArray(appState.savedEndpoints)) {
                        console.warn("Stored endpoints data is not an array, resetting to defaults.");
                        appState.savedEndpoints = [...MAP_CONFIG.defaultEndpoints];
                        this.save();
                    }
                } else {
                    appState.savedEndpoints = [...MAP_CONFIG.defaultEndpoints];
                    this.save();
                }
            } catch (e) {
                console.error("Error loading endpoints from localStorage:", e);
                appState.savedEndpoints = [...MAP_CONFIG.defaultEndpoints];
            }
            console.log("DEBUG: Endpoints loaded:", appState.savedEndpoints.length);
        },

        save: function() {
            try {
                localStorage.setItem(MAP_CONFIG.localStorageKeyEndpoints, JSON.stringify(appState.savedEndpoints));
            } catch (e) {
                console.error("Error saving endpoints to localStorage:", e);
                showMessage("Could not save endpoint list.", 4000);
            }
        },

        populateDropdown: function() {
            while (domElements.savedEndpointsSelect.options.length > 1) { domElements.savedEndpointsSelect.remove(1); }
            appState.savedEndpoints.forEach((endpoint, index) => {
                const option = document.createElement('option');
                option.value = index; // Use index as value
                option.textContent = endpoint.name;
                domElements.savedEndpointsSelect.appendChild(option);
            });
            console.log("DEBUG: Endpoint dropdown populated.");
        },

        add: function() {
            const urlToAdd = domElements.arcgisUrlInput.value.trim();
            if (!urlToAdd) { showMessage("Please enter a URL first.", 3000); return; }
            const isDuplicate = appState.savedEndpoints.some(endpoint => endpoint.url === urlToAdd);
            if (isDuplicate) { showMessage("This URL is already in the saved list.", 3000); return; }

            const nameToAdd = prompt(`Enter a name for this endpoint:\n${urlToAdd}`, "New Endpoint");
            if (!nameToAdd) { showMessage("Add endpoint cancelled.", 2000); return; }

            appState.savedEndpoints.push({ name: nameToAdd, url: urlToAdd });
            appState.savedEndpoints.sort((a, b) => a.name.localeCompare(b.name)); // Keep sorted
            this.save();
            this.populateDropdown();
            showMessage(`Endpoint '${nameToAdd}' added successfully.`, 3000);

            // Select the newly added endpoint
            const newIndex = appState.savedEndpoints.findIndex(ep => ep.url === urlToAdd);
            if (newIndex !== -1) { domElements.savedEndpointsSelect.value = newIndex; }
        },

        handleDropdownChange: function() {
            const selectedIndex = domElements.savedEndpointsSelect.value;
            if (selectedIndex !== "" && appState.savedEndpoints[selectedIndex]) {
                const selectedUrl = appState.savedEndpoints[selectedIndex].url;
                domElements.arcgisUrlInput.value = selectedUrl;
                console.log(`DEBUG: Selected endpoint '${appState.savedEndpoints[selectedIndex].name}', URL set.`);
            } else {
                domElements.arcgisUrlInput.value = "";
            }
        }
    };

    // =========================================================================
    // 7. ArcGIS Feature Layer Management
    // =========================================================================
    const ArcGISLayerManager = {
        resetSelectedFeatureStyle: function() {
            if (appState.selectedArcgisLayer) {
                // Use the *current* style of the parent layer, not the default
                appState.selectedArcgisLayer.setStyle(appState.currentLayerStyle);
            }
        },

        handleFeatureClick: function(e, layer) {
            L.DomEvent.stopPropagation(e); // Prevent map click
            this.resetSelectedFeatureStyle(); // Reset previously selected (if any)

            if (appState.selectedArcgisLayer === layer) {
                // Deselecting
                console.log("DEBUG: -> Deselecting feature.");
                appState.selectedArcgisLayer = null;
                updateCopyButtonState(false);
                showMessage("Feature deselected.");
            } else {
                // Selecting
                console.log("DEBUG: -> Selecting feature.");
                appState.selectedArcgisLayer = layer;
                appState.selectedArcgisLayer.setStyle(MAP_CONFIG.selectedFeatureStyle);
                updateCopyButtonState(true);
                showMessage("Feature selected. Click 'Copy Selected' button.");
            }
        },

        createLayerInstance: function(url) {
            const self = this; // Reference 'this' for nested functions
            return L.esri.featureLayer({
                url: url,
                style: () => appState.currentLayerStyle, // Use dynamic current style
                onEachFeature: function (feature, layer) {
                    // Popup
                    if (feature.properties) {
                        let popupContent = "<b>Attributes:</b><br>";
                        for (const prop in feature.properties) {
                            popupContent += `${prop}: ${feature.properties[prop]}<br>`;
                        }
                        layer.bindPopup(popupContent);
                    }
                    // Selection Click Listener
                    layer.on('click', (e) => self.handleFeatureClick(e, layer));
                }
            });
        },

        handleLayerLoadSuccess: function(newLayer, url) {
            console.log("DEBUG: -> 'load' event fired for layer:", newLayer._leaflet_id);
            showMessage("ArcGIS layer loaded successfully.", 3000);

            // Fetch metadata to get a proper name and fields
            newLayer.metadata((error, metadata) => {
                let layerName = "User Layer"; // Default
                if (error) {
                    console.warn("DEBUG: Could not fetch layer metadata:", error);
                    layerName = getLayerNameFromUrl(url); // Fallback name from URL
                } else if (metadata && metadata.name) {
                    layerName = metadata.name;
                    console.log("DEBUG: -> Using layer name from metadata:", layerName);
                } else {
                    console.warn("DEBUG: Layer metadata loaded, but name property not found.");
                    layerName = getLayerNameFromUrl(url); // Fallback name from URL
                }

                // Add to Layer Control if not already added
                if (!newLayer._addedToControl && appState.layerControl) {
                    console.log("DEBUG: -> Adding layer", newLayer._leaflet_id, "to control with name:", layerName);
                    appState.layerControl.addOverlay(newLayer, layerName);
                    newLayer._addedToControl = true;
                    newLayer._layerName = layerName; // Store the name for reference

                    // Set this as the layer to be filtered/styled
                    appState.currentFilteredLayer = newLayer;
                    appState.currentLayerStyle = { ...MAP_CONFIG.defaultArcgisStyle }; // Reset style state for new layer
                    FilterManager.populateFields(newLayer); // Populate filter dropdown
                    updateFilterControlsState(true);
                    updateStyleControlsState(true); // Enable styling controls
                    updateRemoveButtonState(true); // <-- Enable remove button

                } else if (newLayer._addedToControl) {
                    console.log("DEBUG: -> Layer instance", newLayer._leaflet_id, "already added to control.");
                } else {
                    console.warn("DEBUG: layerControl object not found, cannot add overlay.");
                }

                appState.isArcgisLayerLoading = false;
                console.log("DEBUG: -> State updated: isArcgisLayerLoading set to false.");
            });
        },

        handleLayerLoadError: function(error, layerInstance, type) {
            console.error(`DEBUG: Error loading ArcGIS layer (${type} error):`, error);
            const errorMessage = error?.error?.message1 || error?.error?.message || error?.message || 'Check URL/CORS/Permissions';
            showMessage(`Error loading layer: ${errorMessage}`, 5000);

            if (appState.map.hasLayer(layerInstance)) {
                appState.map.removeLayer(layerInstance);
            }
            if (appState.layerControl && layerInstance._addedToControl) {
                 appState.layerControl.removeLayer(layerInstance);
            }
            if (appState.currentFilteredLayer === layerInstance) {
                appState.currentFilteredLayer = null;
                updateFilterControlsState(false);
                updateStyleControlsState(false);
                updateRemoveButtonState(false); // <-- Disable remove button on error
                updateCopyButtonState(false); // Also ensure copy is disabled
            }

            appState.isArcgisLayerLoading = false;
            console.log(`DEBUG: -> State updated after ${type} error: isArcgisLayerLoading set to false.`);
        },

        loadFeatureLayer: function() {
            console.log("DEBUG: loadArcgisFeatureLayer called");
            if (appState.isArcgisLayerLoading) {
                showMessage("Layer is already loading...", 1500);
                console.log("DEBUG: -> Exiting early: Layer already loading.");
                return;
            }

            // Reset selection state before loading a new layer
            this.resetSelectedFeatureStyle();
            appState.selectedArcgisLayer = null;
            updateCopyButtonState(false);

            // --- If a layer is already loaded, remove it first ---
            // This simplifies state management - only one filterable layer at a time.
            // If you want multiple simultaneous ArcGIS layers, this logic needs adjustment.
            if (appState.currentFilteredLayer) {
                console.log("DEBUG: -> Removing existing filterable layer before loading new one.");
                this.removeCurrentFeatureLayer(false); // Pass false to suppress message
            }
            // --- End removal of previous layer ---

            const url = domElements.arcgisUrlInput.value.trim();
            if (!url) {
                showMessage("Please enter or select a URL.", 3000);
                console.log("DEBUG: -> Exiting early: No URL provided.");
                return;
            }
            if (!url.toLowerCase().includes('/featureserver') && !url.toLowerCase().includes('/mapserver')) {
                showMessage("URL does not look like a valid Feature/Map Server URL.", 4000);
                console.warn("URL might not be a valid Feature/Map Server URL:", url);
                // Optionally return here if strict validation is needed
            }

            showMessage("Loading ArcGIS layer...", 2000);
            console.log("DEBUG: -> Starting load for URL:", url);
            appState.isArcgisLayerLoading = true;
            updateRemoveButtonState(false); // Disable remove button while loading

            // --- Create and add the layer ---
            const newArcgisLayer = this.createLayerInstance(url);
            console.log("DEBUG: Adding new layer instance to map:", newArcgisLayer._leaflet_id);
            newArcgisLayer.addTo(appState.map);

            // --- Attach Event Handlers ---
            newArcgisLayer.on('load', () => this.handleLayerLoadSuccess(newArcgisLayer, url));
            newArcgisLayer.on('requesterror', (e) => this.handleLayerLoadError(e, newArcgisLayer, 'request'));
            newArcgisLayer.on('loaderror', (e) => this.handleLayerLoadError(e, newArcgisLayer, 'load'));
        },

        copySelectedFeature: function() {
            console.log("DEBUG: Copy Selected Button clicked");
            if (appState.selectedArcgisLayer && appState.selectedArcgisLayer.feature) {
                console.log("DEBUG: -> Copying selected feature.");
                const selectedGeoJson = appState.selectedArcgisLayer.toGeoJSON();
                const copiedLayer = L.geoJSON(selectedGeoJson, {
                    style: MAP_CONFIG.copiedFeatureStyle,
                    onEachFeature: function(feature, layer) { layer.bindPopup("Copied Feature"); }
                });

                appState.drawnItems.addLayer(copiedLayer);
                this.resetSelectedFeatureStyle(); // Deselect visually

                // Try to get a meaningful name
                const props = appState.selectedArcgisLayer.feature.properties || {};
                const nameProp = Object.keys(props).find(p => p.toLowerCase().includes('name') || p.toLowerCase().includes('nom') || p.toLowerCase().includes('title'));
                const featureName = nameProp ? props[nameProp] : `Feature ${selectedGeoJson.id || '(no ID)'}`;

                showMessage(`Copied feature: ${featureName}`);
                appState.selectedArcgisLayer = null; // Deselect logically
                updateCopyButtonState(false);
            } else {
                console.log("DEBUG: -> No feature selected to copy.");
                showMessage("Please select a feature on the map first.", 3000);
            }
        },

        // --- Add the remove layer function ---
        removeCurrentFeatureLayer: function(showMsg = true) {
            console.log("DEBUG: removeCurrentFeatureLayer called");
            if (!appState.currentFilteredLayer) {
                console.log("DEBUG: -> No current filterable layer to remove.");
                if (showMsg) showMessage("No ArcGIS layer is currently active to remove.", 3000);
                return;
            }

            const layerToRemove = appState.currentFilteredLayer;
            const layerName = layerToRemove._layerName || 'Layer'; // Get stored name

            console.log(`DEBUG: -> Removing layer: ${layerName} (ID: ${layerToRemove._leaflet_id})`);

            // 1. Remove from Map
            if (appState.map.hasLayer(layerToRemove)) {
                appState.map.removeLayer(layerToRemove);
                console.log("DEBUG: -> Layer removed from map.");
            }

            // 2. Remove from Layer Control
            if (appState.layerControl && layerToRemove._addedToControl) {
                try {
                    appState.layerControl.removeLayer(layerToRemove);
                    console.log("DEBUG: -> Layer removed from layer control.");
                } catch (e) {
                    // Catch potential errors if layer was already removed somehow
                    console.warn("DEBUG: Error removing layer from layer control (might be harmless):", e);
                }
            }

            // 3. Clear related application state
            appState.currentFilteredLayer = null;
            appState.selectedArcgisLayer = null; // Clear selection as well
            appState.currentFilter = null;
            appState.fieldDataTypes = {};
            // Keep currentLayerStyle as is, it will be reset on next load

            // 4. Reset UI Controls
            updateFilterControlsState(false);
            updateStyleControlsState(false);
            updateCopyButtonState(false);
            updateRemoveButtonState(false); // Disable the remove button itself

            if (showMsg) showMessage(`Layer '${layerName}' removed.`);
            console.log("DEBUG: -> Layer removal process complete.");
        }
        // --- End Add ---
    };

    // =========================================================================
    // 8. Filtering Management (No changes needed here)
    // =========================================================================
    const FilterManager = {
        populateFields: function(layer) {
            domElements.filterFieldSelect.innerHTML = '<option value="">-- Select Field --</option>';
            appState.fieldDataTypes = {}; // Clear previous types

            if (!layer || !layer.metadata) {
                console.warn("No layer or metadata available to populate filter fields.");
                updateFilterControlsState(false); // Ensure controls are disabled
                return;
            }

            layer.metadata(function(error, metadata) {
                if (error) {
                    console.error("Error fetching layer metadata for filter fields:", error);
                    showMessage("Could not fetch layer metadata for filtering.", 4000);
                    updateFilterControlsState(false);
                    return;
                }

                if (metadata && metadata.fields) {
                    metadata.fields.forEach(field => {
                        // Exclude geometry and OID fields
                        if (field.type !== "esriFieldTypeGeometry" && field.type !== "esriFieldTypeOID") {
                            const option = document.createElement('option');
                            option.value = field.name;
                            option.textContent = field.alias || field.name; // Use alias if available
                            domElements.filterFieldSelect.appendChild(option);
                            appState.fieldDataTypes[field.name] = field.type; // Store data type
                        }
                    });
                    console.log("DEBUG: Filter fields populated.");
                    updateFilterControlsState(true); // Enable controls now that fields are loaded
                } else {
                    console.warn("No fields found in layer metadata.");
                    showMessage("No filterable fields found in layer.", 4000);
                    updateFilterControlsState(false);
                }
            });
        },

        addCondition: function() {
            const conditionDiv = document.createElement('div');
            conditionDiv.classList.add('filter-condition');

            // Field Dropdown (clone from main selector)
            const fieldSelect = domElements.filterFieldSelect.cloneNode(true);
            fieldSelect.classList.add('filter-field-select'); // Add class for styling/selection
            fieldSelect.removeAttribute('id'); // Remove ID to avoid duplicates
            fieldSelect.disabled = false; // Ensure it's enabled
            conditionDiv.appendChild(fieldSelect);

            // Operator Dropdown
            const operatorSelect = document.createElement('select');
            operatorSelect.classList.add('filter-operator-select');
            // Consider adding more operators based on field type later if needed
            const operators = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN'];
            operators.forEach(op => {
                const option = document.createElement('option');
                option.value = op;
                option.textContent = op;
                operatorSelect.appendChild(option);
            });
            conditionDiv.appendChild(operatorSelect);

            // Value Input
            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.classList.add('filter-value-input');
            valueInput.placeholder = 'Enter value(s)...'; // Hint for IN/NOT IN
            conditionDiv.appendChild(valueInput);

            // Remove Button
            const removeButton = document.createElement('button');
            removeButton.textContent = 'X';
            removeButton.title = 'Remove this condition';
            removeButton.addEventListener('click', () => {
                conditionDiv.remove();
                // Disable Apply button if no conditions are left
                if (domElements.filterConditionsContainer.childElementCount === 0) {
                    domElements.applyFilterButton.disabled = true;
                }
            });
            conditionDiv.appendChild(removeButton);

            domElements.filterConditionsContainer.appendChild(conditionDiv);
            domElements.applyFilterButton.disabled = false; // Enable Apply button
        },

        buildWhereClause: function() {
            const conditions = domElements.filterConditionsContainer.querySelectorAll('.filter-condition');
            const logic = domElements.filterLogicSelect.value; // AND or OR
            const whereClauses = [];

            conditions.forEach(condition => {
                const field = condition.querySelector('.filter-field-select').value;
                const operator = condition.querySelector('.filter-operator-select').value;
                let value = condition.querySelector('.filter-value-input').value.trim();
                const dataType = appState.fieldDataTypes[field];

                if (!field || value === '') {
                    console.warn("Skipping incomplete condition:", { field, operator, value });
                    return; // Skip incomplete conditions
                }

                // Format value based on data type and operator
                if (operator === 'IN' || operator === 'NOT IN') {
                    // Expect comma-separated values
                    const values = value.split(',').map(v => v.trim());
                    let formattedValues;
                    if (dataType === 'esriFieldTypeString' || dataType === 'esriFieldTypeDate' || dataType === 'esriFieldTypeGUID') {
                         // Quote string/date/guid values
                        formattedValues = values.map(v => `'${v.replace(/'/g, "''")}'`).join(','); // Escape single quotes within values
                    } else {
                        // Assume numeric otherwise (or handle other types explicitly)
                        formattedValues = values.filter(v => !isNaN(parseFloat(v))).join(','); // Filter out non-numeric, join
                    }
                    if (formattedValues) { // Only add if there are valid values
                         value = `(${formattedValues})`;
                    } else {
                        console.warn(`Skipping IN/NOT IN condition for field '${field}' due to invalid/empty values.`);
                        return; // Skip if no valid values after formatting
                    }

                } else if (dataType === 'esriFieldTypeString' || dataType === 'esriFieldTypeGUID') {
                    // Quote strings/GUIDs, escape internal single quotes
                    value = `'${value.replace(/'/g, "''")}'`;
                } else if (dataType === 'esriFieldTypeDate') {
                    // Basic date quoting - might need more robust parsing/formatting
                    value = `DATE '${value}'`;
                } else if (operator === 'LIKE' || operator === 'NOT LIKE') {
                     // Add wildcards for LIKE, quote the value
                     value = `'%${value.replace(/'/g, "''")}%'`;
                     value = `'${value}'`; // Wrap the pattern in quotes too
                }
                // Numeric types generally don't need quotes (unless they are actually strings in the DB)

                whereClauses.push(`${field} ${operator} ${value}`);
            });

            if (whereClauses.length === 0) {
                return null; // No valid conditions
            } else if (whereClauses.length === 1) {
                return whereClauses[0];
            } else {
                // Wrap multiple conditions in parentheses for clarity with AND/OR
                return `(${whereClauses.join(` ${logic} `)})`;
            }
        },

        apply: function() {
            if (!appState.currentFilteredLayer) {
                showMessage("No layer loaded to filter.", 3000);
                return;
            }

            const whereClause = this.buildWhereClause();
            console.log("DEBUG: Applying filter:", whereClause);

            if (appState.currentFilteredLayer.setWhere) {
                appState.currentFilteredLayer.setWhere(whereClause); // null is valid to clear filter
                appState.currentFilter = whereClause;
                if (whereClause) {
                    showMessage(`Filter applied: ${whereClause}`);
                    domElements.clearFilterButton.disabled = false;
                } else {
                    showMessage("Filter cleared (no conditions specified).");
                    domElements.clearFilterButton.disabled = true;
                }
            } else {
                console.warn("Layer does not support setWhere.");
                showMessage("Layer does not support filtering.", 4000);
            }
        },

        clear: function() {
            if (!appState.currentFilteredLayer) {
                console.warn("No layer to clear filter from.");
                return;
            }
            if (appState.currentFilteredLayer.setWhere) {
                appState.currentFilteredLayer.setWhere(null); // Clear filter
                appState.currentFilter = null;
                domElements.filterConditionsContainer.innerHTML = ''; // Clear UI conditions
                domElements.applyFilterButton.disabled = true; // Disable apply after clearing
                domElements.clearFilterButton.disabled = true; // Disable clear after clearing
                showMessage("Filter cleared.");
                console.log("DEBUG: Filter cleared.");
            } else {
                console.warn("Layer does not support setWhere.");
                showMessage("Layer does not support filtering.", 4000);
            }
        }
    };

    // =========================================================================
    // 9. Layer Styling Management (No changes needed here)
    // =========================================================================
    const StyleManager = {
        applyColor: function() {
            const newColor = domElements.colorPicker.value;
            if (!appState.currentFilteredLayer) {
                showMessage("No layer loaded to change color.", 3000);
                return;
            }

            console.log("DEBUG: Applying new color:", newColor);

            // Update the current style state
            appState.currentLayerStyle = {
                ...appState.currentLayerStyle, // Keep existing weight, opacity etc.
                color: newColor,
                fillColor: newColor
            };

            // Apply the new style to the layer
            appState.currentFilteredLayer.setStyle(appState.currentLayerStyle);

            // Also reset any selected feature to the new base style
            ArcGISLayerManager.resetSelectedFeatureStyle();

            showMessage(`Layer color changed to ${newColor}`);
        },
    };

    // =========================================================================
    // 10. Drawing & File I/O Management (No changes needed here)
    // =========================================================================
    const DrawManager = {
        initialize: function() {
            const drawControl = new L.Control.Draw({
                edit: {
                    featureGroup: appState.drawnItems,
                    edit: false, // Keep edit disabled as per original
                    remove: true
                },
                draw: {
                    polygon: true,
                    polyline: true,
                    rectangle: true,
                    circle: false,
                    marker: true,
                    circlemarker: false
                }
            });
            appState.map.addControl(drawControl);
            console.log("DEBUG: Draw controls initialized.");

            // Attach Draw Event Handlers
            appState.map.on(L.Draw.Event.CREATED, this.handleDrawCreate);
            appState.map.on(L.Draw.Event.EDITED, this.handleDrawEdit); // Although editing is off, good practice
            appState.map.on(L.Draw.Event.DELETED, this.handleDrawDelete);
        },

        handleDrawCreate: function(event) {
            const layer = event.layer;
            appState.drawnItems.addLayer(layer);
            console.log("DEBUG: Feature drawn and added:", event.layerType);
            showMessage(`Drawn ${event.layerType} added.`);
            // Add popups or other interactions if needed
            layer.bindPopup(`My Drawn ${event.layerType}`);
        },

        handleDrawEdit: function(event) {
            console.log("DEBUG: Features edited.");
            showMessage("Drawn features updated.");
            // If you enable editing, update properties or perform actions here
        },

        handleDrawDelete: function(event) {
            console.log("DEBUG: Features deleted.");
            showMessage("Drawn features removed.");
            // Perform cleanup if necessary
        }
    };

    const FileManager = {
        saveGeoJSON: function() {
            const data = appState.drawnItems.toGeoJSON();
            if (data.features.length === 0) {
                showMessage("No drawn features to save.", 3000);
                return;
            }
            const filename = `map_features_${new Date().toISOString().slice(0, 10)}.geojson`;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showMessage(`Features saved to ${filename}`);
            console.log("DEBUG: GeoJSON saved.");
        },

        loadGeoJSON: function(event) {
            const file = event.target.files[0];
            if (!file) { return; }

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const geojsonData = JSON.parse(e.target.result);
                    const loadedLayer = L.geoJSON(geojsonData, {
                        style: MAP_CONFIG.copiedFeatureStyle, // Style loaded features like copied ones
                        onEachFeature: function (feature, layer) {
                            // Add basic popup from properties if they exist
                            let popupContent = "<b>Loaded Feature</b><br>";
                            if (feature.properties) {
                                for (const prop in feature.properties) {
                                    popupContent += `${prop}: ${feature.properties[prop]}<br>`;
                                }
                            }
                            layer.bindPopup(popupContent);
                        }
                    });
                    appState.drawnItems.addLayer(loadedLayer);
                    appState.map.fitBounds(loadedLayer.getBounds()); // Zoom to loaded features
                    showMessage(`Loaded features from ${file.name}`);
                    console.log("DEBUG: GeoJSON loaded.");
                } catch (error) {
                    console.error("Error parsing GeoJSON file:", error);
                    showMessage(`Error loading file: ${error.message}`, 5000);
                } finally {
                    // Reset file input to allow loading the same file again
                    event.target.value = null;
                }
            };
            reader.onerror = function() {
                showMessage(`Error reading file: ${reader.error}`, 5000);
                 event.target.value = null;
            };
            reader.readAsText(file);
        }
    };

    // =========================================================================
    // 11. Event Listener Initialization
    // =========================================================================
    function initializeEventListeners() {
        // Endpoint Listeners
        domElements.savedEndpointsSelect.addEventListener('change', EndpointManager.handleDropdownChange);
        domElements.addEndpointButton.addEventListener('click', EndpointManager.add);

        // ArcGIS Layer Listeners
        domElements.loadArcgisButton.addEventListener('click', ArcGISLayerManager.loadFeatureLayer.bind(ArcGISLayerManager));
        domElements.removeArcgisButton.addEventListener('click', ArcGISLayerManager.removeCurrentFeatureLayer.bind(ArcGISLayerManager)); // <-- Add listener
        domElements.copySelectedButton.addEventListener('click', ArcGISLayerManager.copySelectedFeature.bind(ArcGISLayerManager));

        // Filter Listeners
        domElements.addFilterConditionButton.addEventListener('click', FilterManager.addCondition);
        domElements.applyFilterButton.addEventListener('click', FilterManager.apply.bind(FilterManager));
        domElements.clearFilterButton.addEventListener('click', FilterManager.clear.bind(FilterManager));

        // Style Listeners
        domElements.applyColorButton.addEventListener('click', StyleManager.applyColor);

        // File I/O Listeners
        domElements.saveButton.addEventListener('click', FileManager.saveGeoJSON);
        domElements.loadInput.addEventListener('change', FileManager.loadGeoJSON);

        console.log("DEBUG: Static event listeners initialized.");
    }

    // =========================================================================
    // 12. Application Initialization
    // =========================================================================
    function initializeApp() {
        console.log("DEBUG: Initializing application...");
        initializeMap();
        EndpointManager.load();
        EndpointManager.populateDropdown();
        DrawManager.initialize(); // Initialize drawing tools
        initializeEventListeners(); // Setup button clicks etc.

        // Disable controls that depend on a loaded layer initially
        updateFilterControlsState(false);
        updateStyleControlsState(false);
        updateCopyButtonState(false);
        updateRemoveButtonState(false); // <-- Ensure remove button is initially disabled

        // Pre-fill input with the first endpoint URL (if any) and attempt to load it
        if (appState.savedEndpoints.length > 0) {
            domElements.arcgisUrlInput.value = appState.savedEndpoints[0].url;
            domElements.savedEndpointsSelect.value = 0; // Select the first item in dropdown
            console.log("DEBUG: -> Calling initial loadArcgisFeatureLayer on startup.");
            ArcGISLayerManager.loadFeatureLayer(); // Load the first layer
        } else {
            console.log("DEBUG: -> No saved endpoints found on startup.");
            showMessage("No default endpoints found. Add or enter an ArcGIS Server URL.", 5000);
        }
        console.log("DEBUG: Application initialization complete.");
    }

    // --- Run Initialization ---
    initializeApp();

}); // End DOMContentLoaded