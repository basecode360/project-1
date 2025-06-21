import React, { useState, useEffect } from 'react';
import apiService from '../api/apiService';

const CompetitorCount = ({ itemSku }) => {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompetitorCount = async () => {
      try {
        // Use the EXACT same logic as CompetitorDetails component
        const userId = localStorage.getItem('user_id');

        // Get API competitors (same as CompetitorDetails)
        let apiCompetitors = [];
        try {
          const apiResponse = await apiService.competitor.getCompetitors(
            itemSku
          );
          if (
            apiResponse.success &&
            apiResponse.data &&
            apiResponse.data.competitors
          ) {
            apiCompetitors = apiResponse.data.competitors.map((comp) => ({
              ...comp,
              id: `api-${comp.itemId}`,
              source: 'API Search',
            }));
          }
        } catch (error) {
          // Silently handle - no API competitors
        }

        // Get manual competitors (same as CompetitorDetails)
        let manualCompetitors = [];
        try {
          const manualResponse =
            await apiService.inventory.getManualCompetitors(itemSku);
          if (manualResponse.success && manualResponse.competitors) {
            manualCompetitors = manualResponse.competitors.map((comp) => ({
              ...comp,
              id: `manual-${comp.competitorItemId}`,
              source: 'Manual',
              itemId: comp.competitorItemId,
            }));
          }
        } catch (error) {
          // Silently handle - no manual competitors
        }

        // Combine all competitors (same as CompetitorDetails)
        const allCompetitors = [...apiCompetitors, ...manualCompetitors];
        setCount(allCompetitors.length);
      } catch (error) {
        console.warn(`Failed to get competitor count for ${itemSku}:`, error);
        setCount(0);
      } finally {
        setLoading(false);
      }
    };

    if (itemSku) {
      fetchCompetitorCount();
    } else {
      setLoading(false);
      setCount(0);
    }
  }, [itemSku]);

  if (loading) {
    return <span style={{ color: '#999' }}>...</span>;
  }

  return <span>{count}</span>;
};

export default CompetitorCount;
