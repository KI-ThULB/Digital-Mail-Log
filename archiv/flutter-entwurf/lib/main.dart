import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'domain.dart';
import 'screens.dart';

void main() => runApp(const PostbuchApp());

class PostbuchApp extends StatefulWidget {
  const PostbuchApp({super.key, this.store});
  final MailStore? store;

  @override
  State<PostbuchApp> createState() => _PostbuchAppState();
}

class _PostbuchAppState extends State<PostbuchApp> {
  late final MailStore store = widget.store ?? MailStore();

  @override
  void dispose() {
    if (widget.store == null) store.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Digitales Postbuch',
    debugShowCheckedModeBanner: false,
    locale: const Locale('de'),
    supportedLocales: const [Locale('de')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff205c54)),
      scaffoldBackgroundColor: const Color(0xfff5f7f6),
      useMaterial3: true,
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        filled: true,
        fillColor: Colors.white,
      ),
    ),
    home: MailOverview(store: store),
  );
}
