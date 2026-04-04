// ==========================================
// 星级评分可视化组件
// ==========================================
import { Star } from 'lucide-react';

interface StarRatingProps {
  rating: number;
  maxRating: number;
}

export function StarRating({ rating, maxRating }: StarRatingProps) {
  const normalizedRating = (rating / maxRating) * 5;
  const fullStars = Math.floor(normalizedRating);
  const hasHalfStar = normalizedRating % 1 >= 0.3;
  
  return (
    <div className="flex">
      {[...Array(5)].map((_, i) => {
        if (i < fullStars) {
          return (
            <Star
              key={i}
              className="text-yellow-400"
              fill="currentColor"
            />
          );
        } else if (i === fullStars && hasHalfStar) {
          return (
            <div key={i} className="relative">
              <Star className="text-gray-600" />
              <div className="absolute inset-0 overflow-hidden w-1/2">
                <Star className="text-yellow-400" fill="currentColor" />
              </div>
            </div>
          );
        } else {
          return (
            <Star
              key={i}
              className="text-gray-600"
            />
          );
        }
      })}
    </div>
  );
}
