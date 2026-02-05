// workspace/skills/weather/index.js
// Demonstrates: read-only tool (no security gate needed)

export const tools = {
  get: async ({ city }, context) => {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;

    try {
      const res = await context.fetch(url);

      if (!res.ok) {
        return {
          success: false,
          error: `Weather API error: ${res.status} ${res.statusText}`,
        };
      }

      const data = await res.json();

      if (!data.current_condition || !data.current_condition[0]) {
        return {
          success: false,
          error: `No weather data found for: ${city}`,
        };
      }

      const current = data.current_condition[0];
      const location = data.nearest_area?.[0];

      return {
        success: true,
        data: {
          city: location?.areaName?.[0]?.value || city,
          country: location?.country?.[0]?.value || null,
          temperature: `${current.temp_C}°C`,
          feelsLike: `${current.FeelsLikeC}°C`,
          description: current.weatherDesc?.[0]?.value || "Unknown",
          humidity: `${current.humidity}%`,
          windSpeed: `${current.windspeedKmph} km/h`,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch weather: ${err.message}`,
      };
    }
  },
};
