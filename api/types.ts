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

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  mark_completed: boolean;
  completed_at?: string | null;
  source_deleted?: boolean;
  source_updated_at?: string | null;
  google_connection_id: string | null;
  google_task_id: string | null;
  google_tasklist_id?: string | null;
  sync_status: 'pending' | 'synced' | 'error';
  created_at: string;
  updated_at: string;
};

export type Schedule = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  valid_from: string;
  valid_to: string;
  mark_completed: boolean;
  completed_at?: string | null;
  source_deleted?: boolean;
  source_updated_at?: string | null;
  google_connection_id: string | null;
  cal_event_id: string | null;
  is_all_day?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  source_timezone?: string | null;
  google_calendar_id?: string;
  recurring_event_id?: string | null;
  sync_status: 'pending' | 'synced' | 'error';
  created_at: string;
  updated_at: string;
};

/** Tables used by this API. Replace with generated Supabase types when available. */
export type CatalogDatabase = {
  public: {
    Tables: {
      schedules: {
        Row: Schedule;
        Insert: Partial<Schedule> & Pick<Schedule, 'user_id' | 'title' | 'valid_from' | 'valid_to'>;
        Update: Partial<Schedule>;
        Relationships: [];
      };
      tasks: {
        Row: Task;
        Insert: Partial<Task> & Pick<Task, 'user_id' | 'title' | 'due_date'>;
        Update: Partial<Task>;
        Relationships: [];
      };
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
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: { id?: string; name?: string; created_at?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
