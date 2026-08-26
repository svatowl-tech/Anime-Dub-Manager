import { Trash2, MessageSquare } from 'lucide-react';
import { Comment } from '../../types';

interface CommentSectionProps {
  comments: Comment[];
  onDeleteComment: (commentId: string) => void;
}

export const CommentSection = ({ comments, onDeleteComment }: CommentSectionProps) => {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 h-[200px] flex flex-col">
      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4" />
        Правки и комментарии
      </h3>
      <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
        {comments.map(comment => (
          <div key={comment.id} className="bg-neutral-800/50 rounded-lg p-3 border border-neutral-700/50 group/comment">
            <div className="flex justify-between items-start mb-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-blue-400 uppercase">{comment.author}</span>
                <span className="text-[10px] text-neutral-500">{new Date(comment.timestamp * 1000).toISOString().substr(14, 5)}</span>
              </div>
              <button 
                onClick={() => onDeleteComment(comment.id)}
                className="opacity-0 group-hover/comment:opacity-100 p-1 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <p className="text-sm text-neutral-200">{comment.text}</p>
          </div>
        ))}
        {comments.length === 0 && (
          <div className="h-full flex items-center justify-center text-neutral-600 text-sm italic">
            Комментариев пока нет
          </div>
        )}
      </div>
    </div>
  );
};
