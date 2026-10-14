/** Public catalog row described in OVERVIEW.md. */
export type Suggestion = {
  id: string;
  title: string;
  youtube_video_id: string;
  video_url: string;
  thumbnail_url: string | null;
  description: string | null;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
};

export type GetSuggestionsParams = { topicId: string };

export type Topic = { id: string; name: string; created_at: string };

export type Task = {
  id: string; title: string; description: string | null;
  due_date: string | null; mark_completed: boolean; completed_at?: string | null;
  google_task_id: string; google_tasklist_id: string;
  source_updated_at?: string | null; source_deleted?: boolean;
};
export type Schedule = {
  id: string; title: string; description: string | null;
  valid_from: string; valid_to: string; mark_completed: boolean; completed_at?: string | null;
  cal_event_id: string; google_calendar_id: string;
  is_all_day?: boolean; start_date?: string | null; end_date?: string | null;
  source_timezone?: string | null; recurring_event_id?: string | null;
  source_updated_at?: string | null; source_deleted?: boolean;
};

/** Tables used by this API. Replace with generated Supabase types when available. */
export type CatalogDatabase = {
  public: {
    Tables: {
      suggestions: {
        Row: Suggestion;
        Insert: Partial<Suggestion> & Pick<Suggestion, 'title' | 'youtube_video_id' | 'video_url'>;
        Update: Partial<Suggestion>;
        Relationships: [];
      };
      suggestion_topics: {
        Row: { suggestion_id: string; topic_id: string };
        Insert: { suggestion_id: string; topic_id: string };
        Update: { suggestion_id?: string; topic_id?: string };
        Relationships: [
          {
            foreignKeyName: 'suggestion_topics_suggestion_id_fkey';
            columns: ['suggestion_id'];
            isOneToOne: false;
            referencedRelation: 'suggestions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'suggestion_topics_topic_id_fkey';
            columns: ['topic_id'];
            isOneToOne: false;
            referencedRelation: 'topics';
            referencedColumns: ['id'];
          },
        ];
      };
      topics: {
        Row: Topic;
        Insert: { id?: string; name: string; created_at?: string };
        Update: { id?: string; name?: string; created_at?: string };
        Relationships: [];
      };
      user_suggestions: {
        Row: { id: string; user_id: string; suggestion_id: string; recommended_at: string };
        Insert: { id?: string; user_id: string; suggestion_id: string; recommended_at?: string };
        Update: { id?: string; user_id?: string; suggestion_id?: string; recommended_at?: string };
        Relationships: [];
      };
      user_topics: {
        Row: { user_id: string; topic_id: string };
        Insert: { user_id: string; topic_id: string };
        Update: { user_id?: string; topic_id?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      fuse_set_user_topics: { Args: { topic_ids: string[] }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
