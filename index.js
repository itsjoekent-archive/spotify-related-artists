require('dotenv').config();

const DEVELOPMENT = process.env.DEVELOPMENT;
const SPOTIFY_API_CLIENT_ID = process.env.SPOTIFY_API_CLIENT_ID;
const SPOTIFY_API_CLIENT_SECRET = process.env.SPOTIFY_API_CLIENT_SECRET;
const SPOTIFY_PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID;

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const json2csv = require('json2csv').Parser;

// table 0. - playlist artists
// columns = artist id, artist name

// table 1. - related artists
// columns = artist id, artist name, total followers

// table 2. - related artists originated from
// columns = artist id, [...playlist artist id's]

// table 3. - related artists genres
// columns = artist id, [...genres]

const tables = [
  [],
  [],
  [],
  [],
];

(async function init() {
  const authHeader = `Basic ${Buffer.from(`${SPOTIFY_API_CLIENT_ID}:${SPOTIFY_API_CLIENT_SECRET}`).toString('base64')}`;

  const authResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'post',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `${encodeURIComponent('grant_type')}=${encodeURIComponent('client_credentials')}`,
  });

  const { access_token: accessToken } = await authResponse.json();

  async function getPlaylistTracks(uri) {
    const defaultUri = `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/tracks`;

    const tracksResponse = await fetch(uri || defaultUri, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const { items, next } = await tracksResponse.json();

    const tracks = items.map(item => item.track);

    return [
      ...tracks,
      ...(next ? await getPlaylistTracks(next) : []),
    ];
  }

  const playlistTracks = await getPlaylistTracks();

  const playlistArtists = playlistTracks.reduce((acc, track) => ([
    ...acc,
    ...track.artists,
  ]), []);

  const originatedFrom = {};

  const genreRelationships = {};
  const genres = [];

  for (const playlistArtist of playlistArtists) {
    const {
      id: playlistArtistId,
      name: playlistArtistName,
    } = playlistArtist;

    if (tables[0].find(row => row.id === playlistArtistId)) {
      continue;
    }

    tables[0].push({
      id: playlistArtistId,
      name: playlistArtistName,
    });

    const relatedArtistsResponse = await fetch(`https://api.spotify.com/v1/artists/${playlistArtistId}/related-artists`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const { artists: relatedArtists } = await relatedArtistsResponse.json();

    for (const relatedArtist of relatedArtists) {
      const {
        id: relatedArtistId,
        name: relatedArtistName,
        genres: relatedArtistGenres,
        followers: {
          total: relatedArtistFollowers,
        },
      } = relatedArtist;

      if (! tables[1].find(row => row.id === relatedArtistId)) {
        tables[1].push({
          id: relatedArtistId,
          name: relatedArtistName,
          followers: relatedArtistFollowers,
        });

        for (const relatedArtistGenre of relatedArtistGenres) {
          if (! genres.includes(relatedArtistGenre)) {
            genres.push(relatedArtistGenre);
          }

          if (! genreRelationships[relatedArtistId]) {
            genreRelationships[relatedArtistId] = [];
          }

          genreRelationships[relatedArtistId].push(relatedArtistGenre);
        }
      }

      if (! originatedFrom[relatedArtistId]) {
        originatedFrom[relatedArtistId] = [];
      }

      originatedFrom[relatedArtistId].push(playlistArtistId);
    }
  }

  const originatedFromTableKeys = [
    'id',
    ...playlistArtists.map(artist => artist.id),
  ];

  for (const relatedArtistId of Object.keys(originatedFrom)) {
    const row = {
      id: relatedArtistId,
    };

    const originatedFromArtists = originatedFrom[relatedArtistId];

    for (const column of originatedFromTableKeys.slice(1)) {
      row[column] = !! originatedFromArtists.includes(column);
    }

    tables[2].push(row);
  }

  const genreTableKeys = [
    'id',
    ...genres,
  ];

  for (const relatedArtistId of Object.keys(genreRelationships)) {
    const row = {
      id: relatedArtistId,
    };

    const relatedArtistGenres = genreRelationships[relatedArtistId];

    for (const column of genreTableKeys.slice(1)) {
      row[column] = !! relatedArtistGenres.includes(column);
    }

    tables[3].push(row);
  }

  if (DEVELOPMENT) {
    fs.writeFileSync(path.join(process.cwd(), 'table0.json'), JSON.stringify({ table: tables[0] }, null, 2));
    fs.writeFileSync(path.join(process.cwd(), 'table1.json'), JSON.stringify({ table: tables[1] }, null, 2));
    fs.writeFileSync(path.join(process.cwd(), 'table2.json'), JSON.stringify({ table: tables[2] }, null, 2));
    fs.writeFileSync(path.join(process.cwd(), 'table3.json'), JSON.stringify({ table: tables[3] }, null, 2));
  }

  function printTable(index, fields) {
    const parser = new json2csv({ fields });
    const csv = parser.parse(tables[index]);

    fs.writeFileSync(path.join(process.cwd(), `table${index}.csv`), csv);
  }

  printTable(0, ['id', 'name']);
  printTable(1, ['id', 'name', 'followers']);
  printTable(2, originatedFromTableKeys);
  printTable(3, genreTableKeys);
})();
