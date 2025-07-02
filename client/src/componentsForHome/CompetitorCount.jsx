// src/componentsForHome/CompetitorCount.jsx - SIMPLE & RELIABLE VERSION
import React, { useState, useEffect } from 'react';
import apiService from '../api/apiService';

const CompetitorCount = ({ itemId }) => {
  const [count, setCount] = useState('...');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompetitorCount = async () => {
      if (!itemId) {
        setCount(0);
        setLoading(false);
        return;
      }

      try {
        console.log(`🔍 Fetching competitor count for itemId: ${itemId}`);

        const manualResponse =
          await apiService.inventory.getManuallyAddedCompetitors(itemId);
        console.log(
          `📊 Manual competitors response for ${itemId}:`,
          manualResponse
        );

        let manualCount = 0;

        if (manualResponse.success) {
          // Use the count field directly from API if available
          if (typeof manualResponse.count === 'number') {
            manualCount = manualResponse.count;
            console.log(
              `✅ Using API count field for ${itemId}: ${manualCount}`
            );
          } else {
            // Fallback: calculate from competitors array
            const competitors = manualResponse.competitors || [];
            manualCount = Array.isArray(competitors) ? competitors.length : 0;
            console.log(
              `✅ Calculated count from array for ${itemId}: ${manualCount}`
            );
          }
        } else {
          console.warn(
            `⚠️ Failed to get manual competitors for ${itemId}:`,
            manualResponse.error
          );
        }

        setCount(manualCount);
      } catch (error) {
        console.error(
          `❌ Error fetching competitor count for ${itemId}:`,
          error
        );
        setCount(0);
      } finally {
        setLoading(false);
      }
    };

    fetchCompetitorCount();
  }, [itemId]);

  if (loading) {
    return <span style={{ color: '#999' }}>...</span>;
  }

  return <span>{count}</span>;
};

export default CompetitorCount;
