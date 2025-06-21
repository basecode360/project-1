import React, { useState, useEffect } from 'react';
import apiService from '../api/apiService';

// Accept itemId instead of itemSku
const CompetitorCount = ({ itemId }) => {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompetitorCount = async () => {
      try {
        // Use the same logic as CompetitorDetails
        // Get API competitors
        let apiCount = 0;
        let manualCount = 0;
        try {
          const apiResponse = await apiService.inventory.getCompetitorPrice(
            itemId
          );
          if (
            apiResponse &&
            apiResponse.productInfo &&
            Array.isArray(apiResponse.productInfo)
          ) {
            apiCount = apiResponse.productInfo.length;
          }
        } catch (error) {
          // Silently handle - no API competitors
        }

        // Get manual competitors
        try {
          const manualResponse =
            await apiService.inventory.getManuallyAddedCompetitors(itemId);
          if (
            manualResponse.success &&
            Array.isArray(manualResponse.competitors)
          ) {
            manualCount = manualResponse.competitors.length;
          }
        } catch (error) {
          // Silently handle - no manual competitors
        }

        setCount(apiCount + manualCount);
      } catch (error) {
        setCount(0);
      } finally {
        setLoading(false);
      }
    };

    if (itemId) {
      fetchCompetitorCount();
    } else {
      setLoading(false);
      setCount(0);
    }
  }, [itemId]);

  if (loading) {
    return <span style={{ color: '#999' }}>...</span>;
  }

  return <span>{count}</span>;
};

export default CompetitorCount;
