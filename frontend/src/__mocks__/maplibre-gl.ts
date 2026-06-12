/**
 * Mock for maplibre-gl — used in Jest tests where WebGL/Canvas is unavailable.
 */

const maplibregl = {
  Map: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    remove: jest.fn(),
    isStyleLoaded: jest.fn(() => false),
    getSource: jest.fn(() => null),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    getCanvas: jest.fn(() => ({ style: {} })),
  })),
  NavigationControl: jest.fn(),
  Popup: jest.fn(),
};

export default maplibregl;
