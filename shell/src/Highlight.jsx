import React from 'react';

export default function Highlight({ text, term }) {
  const value = String(text ?? '');
  const query = String(term ?? '').trim();
  if (!query) return value;
  const index = value.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="eia-search-hit">{value.slice(index, index + query.length)}</mark>
      {value.slice(index + query.length)}
    </>
  );
}
