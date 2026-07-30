/// <reference types="vite/client" />

interface Window {
  domo: {
    get: (url: string) => Promise<any>;
    post: (url: string, data: any) => Promise<any>;
    put: (url: string, data: any) => Promise<any>;
    delete: (url: string) => Promise<any>;
    navigate?: (url: string, target?: string) => void;
    env?: {
      dev?: boolean;
    };
    [key: string]: any;
  };
}
